// External fixture vectors pinned from:
// - parside/src/message/groups/mod.rs tests
// - keripy/tests/core/test_parsing.py assertions

/** Cross-implementation attachment-group vectors pinned from Parside/KERIpy tests. */
export const PARSIDE_GROUP_VECTORS = {
  transIdxSigGroups:
    "-FABEFhg5my9DuMU6gw1CVk6QgkmZKBttWSXDzVzWVmxh0_K0AAAAAAAAAAAAAAAAAAAAAAAEFhg5my9DuMU6gw1CVk6QgkmZKBttWSXDzVzWVmxh0_K-AABAADghKct9eYTuSgSd5wdPSYG06tGX7ZRp_BDnrgbSxJpsJtrA-fP7Pa1W602gHeMrO6HZsD1z3tWV5jGlApFmVIB",
  controllerIdxSigs:
    "-AABAABg3q8uNg1A2jhEAdbKGf-QupQhNnmZQx3zIyPLWBe6qqLT5ynytivf9EwJhxyhy87a0x2cezDdil4SsM2xxs0O",
  nonTransReceiptCouples:
    "-CABBD8-gMSJ6K1PQ7_gG5ZJn2NkHQJgdkiNrTBz_FWWS_cC0BDc1i44ZX0jaIHh5oNDx-TITbPnI6VEn2nKlqPwkkTF452X7XxYh80tolDpReYwZpnD8TF4Or2v3CpSCikyt6EG",
  attachmentGroup:
    "-VA--AABAAAEmCc25ETG2m1Ya-tPGuEqsPywOtusQwXKy076ve56IHXzX2bs0xsdQ4dk0XsanstpThg71ynIy-yUDSue6jMD-BABAABfvC7zCIVOVMol9C4AlSALS9JhL8PCdfgRnJgkXG4U11gFyZbsI_J828POrtwtoOmFhs20hoH1pYw4NZr2cdwN-EAB0AAAAAAAAAAAAAAAAAAAAAAE1AAG2023-02-07T15c00c00d025640p00c00",
  transLastIdxSigGroups:
    "-HABEB1f36VmoizOIpBIBv3X4ZiWJQWjtKJ7TMmsZltT0B32-AABAAAKB9u6wyLS9kl_iGVGCqrs-3XqFbyGeOKuiOEA9JZpxI9GMv0GJv2wbY1-sOD_HOJcvXO7LSO8g8MSeRXjtL4I",
} as const;

/** KERIpy-generated native v2 ICP body used as the main fixed-body parity oracle. */
export const KERIPY_NATIVE_V2_ICP_FIX_BODY =
  "-FA50OKERICAACAAXicpEFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRNDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4HxMAAAMAAB-JALDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4HxMAAB-JALEFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2MAAA-JAA-JAA-JAA";

// KERIpy-generated native v2 route-heavy fixtures. These are pinned from the
// local reference implementation so TS native emit can prove byte parity for
// the route/Pather lane instead of only semantic round trips.
/** KERIpy-generated native v2 `qry` body for route/path-heavy parity checks. */
export const KERIPY_NATIVE_V2_QRY_FIX_BODY =
  "-FA30OKERICAACAAXqryEN0MZ5zwEHpCi297Rg4fu1vfFXSPWHAP9PWVvCEV1_KdDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx1AAG2026-03-17T12c34c56d000000p00c004AABAksn6AACAAAreply-IAOXpreDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx0Ksn0J_0";

/** KERIpy-generated native v2 `rpy` body for reply-lane parity checks. */
export const KERIPY_NATIVE_V2_RPY_FIX_BODY =
  "-FA00OKERICAACAAXrpyEC3ROJicV8vVIGdoIwz87uZlllUQ4DBn6yomD6TjG8eADNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx1AAG2026-03-17T12c34c56d000000p00c006AADAAAintroduce-IAMXcidDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx";

/** KERIpy-generated native v2 `xip` body for exchange/embed parity checks. */
export const KERIPY_NATIVE_V2_XIP_FIX_BODY =
  "-FBC0OKERICAACAAXxipEMI8iAwjQnczX7pJYuz7RWGhccR0Xved3o8jE34fSaAH0AAb4Y8P4m9N2S8RULf7rqmRDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4HxEFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRN1AAG2026-03-17T12c34c56d000000p00c004AABipex-IAE1AAFrole0Missuer-IAG0J_d1AAP0Maction0L_grant";

/** KERIpy-generated native v2 `exn` body for compact/native ACDC exchange coverage. */
export const KERIPY_NATIVE_V2_EXN_FIX_BODY =
  "-FBd0OKERICAACAAXexnEB69IykjPhbbu2PU-TbK5ecI7KKFaG34yC3-W6uWaLykDNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4HxEFaYE2LTv8dItUgQzIHKRA9FaHDrHtIHNs-m5DJKWXRNEFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2EN0MZ5zwEHpCi297Rg4fu1vfFXSPWHAP9PWVvCEV1_Kd1AAG2026-03-17T12c34c56d000000p00c004AAEcredential-issue-IAN0MschemaEFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2-IAF0J_d1AAP0J_m0L_hello";

/** KERIpy-generated v1 JSON ICP body retained for non-native version-string parity checks. */
export const KERIPY_V1_JSON_ICP_BODY =
  "{\"v\":\"KERI10JSON00012b_\",\"t\":\"icp\",\"d\":\"EIcca2-uqsicYK7-q5gxlZXuzOkqrNSL3JIaLflSOOgF\",\"i\":\"DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx\",\"s\":\"0\",\"kt\":\"1\",\"k\":[\"DNG2arBDtHK_JyHRAq-emRdC6UM-yIpCAeJIWDiXp4Hx\"],\"nt\":\"1\",\"n\":[\"EFXIx7URwmw7AVQTBcMxPXfOOJ2YYA1SJAam69DXV8D2\"],\"bt\":\"0\",\"b\":[],\"c\":[],\"a\":[]}";
