/**
 * KERIpy `main` primitive vectors and codex constants.
 *
 * Source baseline:
 * - repo: /Users/kbull/code/keri/wot/keripy
 * - branch: main
 * - commit: 5a5597e8b7f7
 *
 * Primary sources:
 * - tests/core/test_coring.py
 * - tests/core/test_indexing.py
 * - tests/core/test_counting.py
 * - tests/core/test_signing.py
 */

export const KERIPY_MAIN_BASELINE = {
  branch: "main",
  commit: "5a5597e8b7f7",
} as const;

/** Selected Matter/primitive qb64 vectors from KERIpy tests. */
export const KERIPY_MATTER_VECTORS = {
  ilker: "Xicp",
  verserKeri20: "YKERICAA",
  traitorEO: "0KEO",
  labelerI: "0J_i",
  texterSimple: "4BABAAAA",
  bexterSimple: "4AABabcd",
  patherSimple: "4AABabcd",
  daterSample: "1AAG2023-02-07T15c00c00d025640p00c00",
  digerBlake3: "ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux",
  noncerSalt128: "0AAxyHwW6htOZ_rANOaZb2N2",
  prefixerEd25519N: "BKxy2sgzfplyr-tgwIxS19f2OchFHtLwPWD3v4oYimBx",
  verferEcdsaK1: "1AABAtuYM4WoDrt8FV3dxkdqJAeafJZfBQ9i3i1HVptUKRZ5",
  verferEcdsaR1: "1AAJA3cK_P2CDlh-_EMFPvyqTPI1POkw-dr14DANx5JEXDCZ",
  verferEcdsaR1Vector: "1AAJAxaZvKBRj6Zss11rCpL2hJYoe7Zk6OhXaRW46poCBir_",
  cigarEcdsaK1: "0CBfgMBa5HEyXffL2xvC9BHDBa_0vjt-rD6MFTqfpQo9aXVFkzTIliv-eY3RTpwfbKfIEtZ6bMV0n--NpyWilUfM",
  cigarEcdsaR1: "0ICM-rRAAdKrSrzFlouiZXbNUZ07QMM1IXOaG-gv4TAo4QeQCKZC1z82jJYy_wFkAxgIhbikl3a-nOTXxecF2lEj",
  saiderAcdc: "EMRvS7lGxc1eDleXBkvSHkFs8vUrslRcla6UXOJdcczw",
  numberShort: "MPd_",
  seqnerZero: "0AAAAAAAAAAAAAAAAAAAAAAA",
  seqnerFive: "0AAAAAAAAAAAAAAAAAAAAAAF",
  decimerZeroInt: "6HABAAA0",
  decimerZeroFloat: "4HABA0p0",
  decimerInt12345678: "4HAC12345678",
  decimerFloat123456789: "5HADAA12p3456789",
  taggerSimple: "0J_z",
  labelerEmpty: "1AAP",
  salterFixed: "0AAwMTIzNDU2Nzg5YWJjZGVm",
  signerSeedR1: "QJ97qKeoQzmWJvqxmeuqIMQbRxHErlNBUsm9BJ2FKX6T",
  signerSeedK1: "JJ97qKeoQzmWJvqxmeuqIMQbRxHErlNBUsm9BJ2FKX6T",
  signerSeedR1Vector: "QDWGyaBNM2eF1eRq2mLwVMWl9DI_RsuSIwfg4nm35fUK",
  signerSeedK1Vector: "JH-YCjvkRdeMyXmh7iYgnBdxFqum1vFqAeezzv7ibAYI",
  signerSeedEd25519Vector: "ABg7MMQPKnZG-uOiRWVlH5ZvzilHheNYhtoE8NzeBsAr",
  keeperCryptSeedEd25519: "AGgsI3yKcCISxDN0MqbhGBnwZjIsecTCMUD1QBUuohrP",
  salterCipherPlain: "0AA2CGQNobs5jXCNoMATSody",
  encrypterX25519: "CAF7Wr3XNq5hArcOuBJzaY6Nd23jgtUVI6KDfb3VngkR",
  decrypterX25519Private: "OLCFxqMz1z1UUS0TEJnvZP_zXHcuYdQsSGBWdOZeY5VQ",
  cipherSeedVector:
    "PM9jOGWNYfjM_oLXJNaQ8UlFSAV5ACjsUY7J16xfzrlpc9Ve3A5WYrZ4o_NHtP5lhp78Usspl9fyFdnCdItNd5JyqZ6dt8SXOt6TOqOCs-gy0obrwFkPPqBvVkEw",
  cipherSaltVector:
    "1AAHjlR2QR9J5Et67Wy-ZaVdTryN6T6ohg44r73GLRPnHw-5S3ABFkhWyIwLOI6TXUB_5CT13S8JvknxLxBaF8ANPK9FSOPD8tYu",
} as const;

/** Selected Indexer/Siger vectors from KERIpy tests. */
export const KERIPY_INDEXER_VECTORS = {
  ed25519SigIdx0: "AACZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  ed25519SigIdx5: "AFCZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  ed25519BigSigIdx67: "2ABDBDCZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  ed25519BigSigIdx90Ondex65:
    "2ABaBBCZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  ed25519CrtSigIdx3: "BDCZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  ed25519BigCrtSigIdx68: "2BBEAACZ0jw5JCQwn2v7GKCMQHISMi5rsscfcA4nbY9AqqWMyG6FyCH2cZFwqezPkq8p3sr8f37Xb3wXgh3UPG8igSYJ",
  tbd0Label: "0zAEHello_World_Peep",
  sigerSample: "AACdI8OSQkMJ9r-xigjEByEjIua7LHH3AOJ22PQKqljMhuhcgh9nGRcKnsz5KvKd7K_H9-1298F4Id1DxvIoEmCQ",
} as const;

/** Selected Counter vectors from KERIpy tests. */
export const KERIPY_COUNTER_VECTORS = {
  v1ControllerIdxSigsCount1: "-AAB",
  v1ControllerIdxSigsCount5: "-AAF",
  v1BigAttachmentGroupCount100024000: "--VF9j7A",
  v1BigPathedMaterialCouplesCount100024000: "--LF9j7A",
  v1BigAttachmentGroupCount1024: "--VAAAQA",
  v1GenusVersion000: "-_AAAAAA",
  v2ControllerIdxSigsCount1: "-KAB",
  v2ControllerIdxSigsCount5: "-KAF",
  v2BigGenericGroupCount1024: "--AAAAQA",
  v2BigGenericGroupCount8193: "--AAACAB",
  v2GenusVersion000: "-_AAAAAA",
} as const;

/** KERIpy codex values reused by per-primitive tests. */
export const KERIPY_CODE_VECTORS = {
  signerSeedCodes: ["A", "J", "Q"],
  salterCodes: ["0A"],
  cipherSeedCode: "P",
  encrypterCode: "C",
  decrypterCode: "O",
  taggerCodeIlk: "X",
  verserCodes: ["Y", "0O"],
} as const;

/** Selected Structor/Aggor family vectors from `tests/core/test_structing.py` + `test_mapping.py`. */
export const KERIPY_STRUCTOR_VECTORS = {
  aggorEmptyList: "-JAA",
  sealerTypedDigestEnclosed: "-WANYOCSRCAAEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
  sealerTypedDigestPayload: "YOCSRCAAEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
  blinderBlindStateEnclosed:
    "-aAjEBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0Missued",
  blinderBlindStatePayload:
    "EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0Missued",
  mediarTypedMediaEnclosed:
    "-cAjEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE0ABtZWRpYXJyYXdub25jZV8w6BAGAABhcHBsaWNhdGlvbi9qc29u5BAKAHsibmFtZSI6IlN1ZSIsImZvb2QiOiJQaXp6YSJ9",
  mediarTypedMediaPayload:
    "EHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE0ABtZWRpYXJyYXdub25jZV8w6BAGAABhcHBsaWNhdGlvbi9qc29u5BAKAHsibmFtZSI6IlN1ZSIsImZvb2QiOiJQaXp6YSJ9",
} as const;

/** Selected fixed-field structing vectors from `tests/core/test_structing.py`. */
export const KERIPY_STRUCTING_DATA_VECTORS = {
  sealEvent: {
    i: "BN5Lu0RqptmJC-iXEldMMrlEew7Q01te2fLgqlbqW9zR",
    s: "e",
    sQb64: "MAAO",
    d: "ELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux",
    qb64: "BN5Lu0RqptmJC-iXEldMMrlEew7Q01te2fLgqlbqW9zRMAAOELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux",
    enclosed: "-TAXBN5Lu0RqptmJC-iXEldMMrlEew7Q01te2fLgqlbqW9zRMAAOELC5L3iBVD77d_MYbYGGCUQgqQBju1o4x1Ud-z2sL-ux",
  },
  sealKind: {
    t: "YOCSRCAA",
    d: "EHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
    qb64: "YOCSRCAAEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
    enclosed: "-WANYOCSRCAAEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
  },
  blindState: {
    d: "EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769",
    u: "aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPd",
    td: "EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ",
    ts: "issued",
    tsQb64: "0Missued",
    qb64:
      "EBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0Missued",
    enclosed:
      "-aAjEBTAKXL5si31rCKCimOwR_gJTRmLaqixvrJEj5OzK769aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0Missued",
  },
  boundState: {
    d: "EKmyRBn1mDRwPOB4TPimWJG_vqr-Kz1U2HyukGXzV7-1",
    u: "aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPd",
    td: "EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ",
    ts: "issued",
    tsQb64: "0Missued",
    bn: "2",
    bnQb64: "MAAC",
    bd: "EJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv",
    qb64:
      "EKmyRBn1mDRwPOB4TPimWJG_vqr-Kz1U2HyukGXzV7-1aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0MissuedMAACEJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv",
    enclosed:
      "-bAvEKmyRBn1mDRwPOB4TPimWJG_vqr-Kz1U2HyukGXzV7-1aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPdEBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ0MissuedMAACEJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv",
  },
  typeMedia: {
    d: "EHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE",
    u: "0ABtZWRpYXJyYXdub25jZV8w",
    mt: "application/json",
    mtQb64: "6BAGAABhcHBsaWNhdGlvbi9qc29u",
    mv: "{\"name\":\"Sue\",\"food\":\"Pizza\"}",
    mvQb64: "5BAKAHsibmFtZSI6IlN1ZSIsImZvb2QiOiJQaXp6YSJ9",
    qb64:
      "EHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE0ABtZWRpYXJyYXdub25jZV8w6BAGAABhcHBsaWNhdGlvbi9qc29u5BAKAHsibmFtZSI6IlN1ZSIsImZvb2QiOiJQaXp6YSJ9",
    enclosed:
      "-cAjEHYFmR_QWCLz8gZyhc4BQ8xJ-ftZ6OA4fNmuu1ZAvyTE0ABtZWRpYXJyYXdub25jZV8w6BAGAABhcHBsaWNhdGlvbi9qc29u5BAKAHsibmFtZSI6IlN1ZSIsImZvb2QiOiJQaXp6YSJ9",
  },
} as const;

/** Blinder helper vectors derived from `tests/core/test_structing.py`. */
export const KERIPY_DISCLOSURE_HELPER_VECTORS = {
  salt: "0ABdM7EmNFAlGe05ng6s1ljh",
  placeholderBlind: {
    sn: 1,
    uuid: "aE3_MHQbvGMppHB9ZiRxhIq6oEoYPm8AGBxMmSrcBCG_",
    acdc: "",
    state: "",
    said: "EGwVS-ldAC1LTERsS34nsZITPqb4xc0CCzVTKgLST5NV",
    states: ["issued", "revoked"],
  },
  revokedBlind: {
    sn: 2,
    uuid: "aB3RS8CZP2ds_ZgUyJBuJyim8P8qLRG9wMANIkWPGzev",
    acdc: "EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ",
    state: "revoked",
    said: "EGhjWjnjDTBTQ5uZ-17_nipeMzaCaADNeMBXa8QmmBev",
    states: ["issued", "revoked"],
  },
  placeholderBound: {
    sn: 1,
    uuid: "aE3_MHQbvGMppHB9ZiRxhIq6oEoYPm8AGBxMmSrcBCG_",
    acdc: "",
    state: "",
    bsn: "0",
    bd: "",
    said: "EOj0JmuM1wUbifbztCdA6av1EdV7AYb0hRkUeScCm8G4",
    states: ["issued", "revoked"],
    bounds: [["2", "EJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv"]] as const,
  },
  revokedBound: {
    sn: 2,
    uuid: "aB3RS8CZP2ds_ZgUyJBuJyim8P8qLRG9wMANIkWPGzev",
    acdc: "EBju1o4x1Ud-z2sL-uxLC5L3iBVD77d_MYbYGGCUQgqQ",
    state: "revoked",
    bsn: "2",
    bd: "EJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv",
    said: "EEeMsBUnPL6kXTRHZoLqkYCuvIAN8LjV-GpIet2Th2e9",
    states: ["issued", "revoked"],
    bounds: [["2", "EJOnAKXGaSyJ_43kit0V806NNeGWS07lfjybB1UcfWsv"]] as const,
  },
  wrongUuid: "aJte0a_x8dBbGQrBkdYRgkzvFlQss3ovVOkUz1L1YGPA",
} as const;
