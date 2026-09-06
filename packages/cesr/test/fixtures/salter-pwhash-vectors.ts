/** Independent pysodium ARGON2ID13 vectors using KERIpy Salter tier parameters. */
export const SALTER_PWHASH_VECTORS = {
  "source": "pysodium crypto_pwhash ARGON2ID13 using KERIpy Salter parameters",
  "salt": "000102030405060708090a0b0c0d0e0f",
  "cases": [
    {
      "mode": "temp",
      "path": "",
      "size": 16,
      "hex": "35858230a16f87fed2b29838c1fe2df6",
    },
    {
      "mode": "temp",
      "path": "a\u0000b",
      "size": 32,
      "hex": "d61ebacbea2088c635bdef12bc8f9cf30b206e787ca224e6e6d86d05784d9e8d",
    },
    {
      "mode": "temp",
      "path": "Unicode-é-🔐",
      "size": 64,
      "hex":
        "88841118f8c6de492b39c59d684ec5ed66f37cef740104e1a6be4b83752b25ea02434b8f505a395146af7c5444e620d2505cd635f384a50ef678193c9c7a417b",
    },
    {
      "mode": "low",
      "path": "",
      "size": 32,
      "hex": "bed4350c496024724d50592eb2cd4f61b3333ea871c495f63a4f687aed67f82c",
    },
    {
      "mode": "low",
      "path": "0",
      "size": 32,
      "hex": "428ea067ab4d98a52661dd0c2d3a2867aefd33652fe18b0ed77d4e7a60aaebe1",
    },
    {
      "mode": "low",
      "path": "Unicode-é-🔐",
      "size": 64,
      "hex":
        "f52aa1b62f9059823f7843784389a09b006842701c3af68caa3ba6544fb7db67e322370a413a57ab5db1d65a41c26a2066b809cc927986ce1c4f25e759c67923",
    },
    {
      "mode": "med",
      "path": "01",
      "size": 32,
      "hex": "ab6256bcdfe02e2ba171b33e0026c62f2b79c4f2cfa199a86b7ef814579bbdcd",
    },
    {
      "mode": "high",
      "path": "01",
      "size": 32,
      "hex": "79235489874009345d96f41eb6ddcfc0e384e78b8be3f3566a75bf4217bc043c",
    },
  ],
} as const;
