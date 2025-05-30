/**
 * Copyright (c) HashiCorp, Inc.
 * SPDX-License-Identifier: MPL-2.0
 */

import Model, { attr } from '@ember-data/model';
import { inject as service } from '@ember/service';
import { tracked } from '@glimmer/tracking';
import lazyCapabilities, { apiPath } from 'vault/macros/lazy-capabilities';
import { withFormFields } from 'vault/decorators/model-form-fields';
import { withModelValidations } from 'vault/decorators/model-validations';

const validations = {
  type: [{ type: 'presence', message: 'Type is required.' }],
  commonName: [{ type: 'presence', message: 'Common name is required.' }],
  issuerName: [
    {
      validator(model) {
        if (
          (model.actionType === 'generate-root' || model.actionType === 'rotate-root') &&
          model.issuerName === 'default'
        )
          return false;
        return true;
      },
      message: `Issuer name must be unique across all issuers and not be the reserved value 'default'.`,
    },
  ],
  keyName: [
    {
      validator(model) {
        if (model.keyName === 'default') return false;
        return true;
      },
      message: `Key name cannot be the reserved value 'default'`,
    },
  ],
};

/**
 * This model maps to multiple PKI endpoints, specifically the ones that make up the
 * configuration/create workflow. These endpoints also share a nontypical behavior in that
 * a POST request to the endpoints don't necessarily result in a single entity created --
 * depending on the inputs, some number of issuers, keys, and certificates can be created
 * from the API.
 */
@withModelValidations(validations)
@withFormFields()
export default class PkiActionModel extends Model {
  @service secretMountPath;

  @tracked actionType; // used to toggle between different form fields when creating configuration

  /* actionType import */
  @attr('string') pemBundle;

  // parsed attrs from parse-pki-cert util if certificate on response
  @attr parsedCertificate;

  // readonly attrs returned after importing
  @attr importedIssuers;
  @attr importedKeys;
  @attr mapping;
  @attr('string', { readOnly: true, masked: true }) certificate;

  /* actionType generate-root */

  // readonly attrs returned right after root generation
  @attr serialNumber;
  @attr('string', { label: 'Issuing CA', readOnly: true, masked: true }) issuingCa;
  // end of readonly

  @attr('string', {
    possibleValues: ['exported', 'internal', 'existing', 'kms'],
    noDefault: true,
  })
  type;

  @attr('string') issuerName;

  @attr('string') keyName;

  @attr('string', {
    defaultValue: 'default',
    label: 'Key reference',
  })
  keyRef; // type=existing only

  @attr('string') commonName; // REQUIRED

  @attr('string', {
    label: 'Subject Alternative Names (SANs)',
    editType: 'stringArray',
  })
  altNames;

  @attr('string', {
    label: 'IP Subject Alternative Names (IP SANs)',
    editType: 'stringArray',
  })
  ipSans;

  @attr('string', {
    label: 'URI Subject Alternative Names (URI SANs)',
    editType: 'stringArray',
  })
  uriSans;

  @attr('string', {
    label: 'Other SANs',
    editType: 'stringArray',
  })
  otherSans;

  @attr('string', {
    defaultValue: 'pem',
    possibleValues: ['pem', 'der', 'pem_bundle'],
  })
  format;

  @attr('string', {
    defaultValue: 'der',
    possibleValues: ['der', 'pkcs8'],
  })
  privateKeyFormat;

  @attr('string', {
    defaultValue: 'rsa',
    possibleValues: ['rsa', 'ed25519', 'ec'],
  })
  keyType;

  @attr('string', {
    defaultValue: '0',
    // options management happens in pki-key-parameters
  })
  keyBits;

  @attr('number', {
    defaultValue: -1,
  })
  maxPathLength;

  @attr('boolean', {
    label: 'Exclude common name from SANs',
    subText:
      'If checked, the common name will not be included in DNS or Email Subject Alternate Names. This is useful if the CN is a human-readable identifier, not a hostname or email address.',
    defaultValue: false,
  })
  excludeCnFromSans;

  @attr('string', {
    label: 'Permitted DNS domains',
  })
  permittedDnsDomains;

  @attr('string', {
    label: 'Organizational Units (OU)',
    subText:
      'A list of allowed serial numbers to be requested during certificate issuance. Shell-style globbing is supported. If empty, custom-specified serial numbers will be forbidden.',
    editType: 'stringArray',
  })
  ou;
  @attr({ editType: 'stringArray' }) organization;
  @attr({ editType: 'stringArray' }) country;
  @attr({ editType: 'stringArray' }) locality;
  @attr({ editType: 'stringArray' }) province;
  @attr({ editType: 'stringArray' }) streetAddress;
  @attr({ editType: 'stringArray' }) postalCode;

  @attr('string', {
    subText:
      "Specifies the requested Subject's named Serial Number value. This has no impact on the Certificate's serial number randomly generated by OpenBao.",
  })
  subjectSerialNumber;
  // this is different from the number (16:5e:a0...) randomly generated by Vault
  // https://openbao.org/api-docs/secret/pki#serial_number

  @attr('boolean', {
    subText: 'Whether to add a Basic Constraints extension with CA: true.',
  })
  addBasicConstraints;

  @attr({
    label: 'Backdate validity',
    detailsLabel: 'Issued certificate backdating',
    helperTextDisabled: 'OpenBao will use the default value, 30s',
    helperTextEnabled:
      'Also called the not_before_duration property. Allows certificates to be valid for a certain time period before now. This is useful to correct clock misalignment on various systems when setting up your CA.',
    editType: 'ttl',
    defaultValue: '30s',
  })
  notBeforeDuration;

  @attr('string') managedKeyName;
  @attr('string', {
    label: 'Managed key UUID',
  })
  managedKeyId;

  @attr({
    label: 'Not valid after',
    detailsLabel: 'Issued certificates expire after',
    subText:
      'The time after which this certificate will no longer be valid. This can be a TTL (a range of time from now) or a specific date.',
    editType: 'yield',
  })
  customTtl;
  @attr('string') ttl;
  @attr('date') notAfter;

  @attr('string', { label: 'Issuer ID', readOnly: true, detailLinkTo: 'issuers.issuer.details' }) issuerId; // returned from generate-root action

  // For generating and signing a CSR
  @attr('string', { label: 'CSR', masked: true }) csr;
  @attr caChain;
  @attr('string', { label: 'Key ID', detailLinkTo: 'keys.key.details' }) keyId;
  @attr('string', { masked: true }) privateKey;
  @attr('string') privateKeyType;

  get backend() {
    return this.secretMountPath.currentPath;
  }

  // To determine which endpoint the config adapter should use,
  // we want to check capabilities on the newer endpoints (those
  // prefixed with "issuers") and use the old path as fallback
  // if user does not have permissions.
  @lazyCapabilities(apiPath`${'backend'}/issuers/import/bundle`, 'backend') importBundlePath;
  @lazyCapabilities(apiPath`${'backend'}/issuers/generate/root/${'type'}`, 'backend', 'type')
  generateIssuerRootPath;
  @lazyCapabilities(apiPath`${'backend'}/issuers/generate/intermediate/${'type'}`, 'backend', 'type')
  generateIssuerCsrPath;
  @lazyCapabilities(apiPath`${'backend'}/issuers/cross-sign`, 'backend') crossSignPath;

  get canImportBundle() {
    return this.importBundlePath.get('canCreate') === true;
  }
  get canGenerateIssuerRoot() {
    return this.generateIssuerRootPath.get('canCreate') === true;
  }
  get canGenerateIssuerIntermediate() {
    return this.generateIssuerCsrPath.get('canCreate') === true;
  }
  get canCrossSign() {
    return this.crossSignPath.get('canCreate') === true;
  }
}
