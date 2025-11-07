# LMDB Dumper

Being able to see what is in the database is the first task for keri-ts. The critical goal here is to maintain a 1:1 mapping between KERIpy's database format and KERI TS's database format. We're going to take all of the database key value pairs in KERIpy's Baser, Reger, Keeper, Noter, and Mailboxer and be able to dump all of them to the console so it is easy to see both key space and value space that is used in a human-friendly dump format. We will also support the option to dump the data to a CSV file for easy processing with other data tools.

See the below Emacs Org Mode notes for tables of these key value pairs.

See the following outline of our tasks in order of priority and approach.

# Task Outline

We need to get base LMDB read, write, and ordered key/value pairs functional and tested first. Then we move on to database by database support for all of the KERIpy LMDB key and value pairs.

## Prioritized Tasks

1. Get a basic LMDBer implementation working with get, set, put, del, cnt, getIter, and so forth, and database migrations starting from version 1.0 as the first migration.
2. Support reading the evts. key value pair.

## Style and coding guides.

# Emacs Org Mode Notes per LMDBer subclass

## Baser:

```org
** Baser (79) - stores KEL events and related data
Baser sets up an identifier-specific, named database that stores key event logs for that identifier.
DB: db
Path: keri/db
Acronyms: NTsig = non-transferable signers (witnesses or watchers), TRsigs = transferable signers (controllers)
| LMDB key | Baser DB prop | db-class          | description                                                                         | Mult | Key schema                | value schema                   |
|----------+---------------+-------------------+-------------------------------------------------------------------------------------+------+---------------------------+--------------------------------|
| evts.    | .evts         | LMDB              | dgKey: serialized KEL events                                                        |    1 | (pre, evt SAID)           | raw SerderKERI                 |
| fels.    | .fels         | LMDB              | fnKey: first seen event logs (FELs) maps on -> digest                               |    1 | (pre, fn)                 | SAID of evt                    |
| kels.    | .kels         | LMDB              | snKey: Key Event Logs map sn -> KEL evt digest                                      |    * | (pre, sn)                 | SAID                           |
| dtss.    | .dtss         | LMDB              | dgKey: timestamp when evt escrowed, then seen; used in timeouts                     |    1 | (pre, SAID)               | dt (binary)                    |
| aess.    | .aess         | LMDB              | dgKey: authorizing event source seal couples map dig -> couple of authorizer's evt  |    1 | (pre, SAID)               | (Huge sn, SAID)                |
| sigs.    | .sigs         | LMDB              | dgKey: fully qualified indexed event signatures                                     |    * | (pre, said)               | [Siger]                        |
| wigs.    | .wigs         | LMDB              | dgKey: indexed witness signatures of event from, or derived from, witness receipt   |    * | (pre, said)               | [Wiger]                        |
| rcts.    | .rcts         | LMDB              | dgKey: event receipt couplets from NTsigs not witnesses(watchers/juror)             |    * | (pre, said)               | [(cigar.verfer, cigar)]        |
| ures.    | .ures         | LMDB              | escrow: snKey: unverified event receipt escrowed triples from NTsigs                |    * | (pre, sn)                 | [(dig, pre, cig)]              |
| vrcs.    | .vrcs         | LMDB              | dgKey: event validator receipt quadruples from TRsigs                               |    * | (pre, dig)                | [(pre, sn, SAID, sig)]         |
| vres.    | .vres         | LMDB              | dgKey: unverified event validator receipt escrowed quadruples from TRsigs           |    * | (pre, sn)                 | [(edig, spre, ssn, sdig, sig)] |
| pses.    | .pses         | LMDB              | snKey: partially signed key event escrows; maps pre+sn -> SAID                      |    * | (pre, sn)                 | [said]                         |
| pwes.    | .pwes         | LMDB              | snKey: partially witnessed key event escrows; maps pre+sn -> SAID                   |    * | (pre, sn)                 | [said]                         |
| pdes.    | .pdes         | OnIoDupSuber      | snKey: partially delegated key event escrows; maps pre+sn -> SAID                   |    * | (pre, sn)                 | [said]                         |
| udes.    | .udes         | CatCesrSuber      | dgKey: unverified delegation seal source couple escrows; maps pre,dig -> seal       |    1 | (pre, said)               | (Seqner, Saider)               |
| uwes.    | .uwes         | LMDB              | snKey: unverified event indexed escrowed couples from witness signers               |    * | (pre, sn)                 | [bytes(edig + wig)]            |
| ooes.    | .ooes         | LMDB              | snKey: out of order escrowed event tables; maps pre+sn -> SAID                      |    * | (pre, sn)                 | [said]                         |
| dels.    | .dels         | LMDB              | snKey: duplicitous event log tables; maps sn -> SAID                                |    * | (pre, sn)                 | [dig]                          |
| ldes.    | .ldes         | LMDB              | snKey: likely duplicitous escrowed event tables; maps sn -> SAID                    |    * | (pre, sn)                 | [said]                         |
| qnfs.    | .qnfs         | IoSetSuber        | dgKey: query not found escrows; maps pre+SAID -> SAID                               |    * | (pre, said)               | [saidb]                        |
| fons.    | .fons         | CesrSuber         | dgKey: first seen ordinal number of seen events, for superseeding recovery rotation |    1 | (pre, said)               | Seqner                         |
| migs.    | .migs         | CesrSuber         | database migrations                                                                 |    1 | string                    | dt                             |
| vers.    | .vers         | Suber             | database version table (unused)                                                     |    1 | (str,)                    | Dater                          |
| esrs.    | .esrs         | Komer             | dgKey: event source record: local (protected) or non-local (remote, not protected)  |    1 | (str,)                    | str                            |
| mfes.    | .misfits      | IoSetsuber        | snKey: misfit escrows, remote (non-local) events to be dropped unless authenticated |    1 | (pre, said)               | EventSourceRecord              |
| dees.    | .delegables   | IoSetSuber        | snKey: delegable event escrows of KEL evts with local delegator needing approval    |    1 | (pre, snh)                | said                           |
| stts.    | .states       | Komer             | latest keystate for a prefix; maps prefix -> keystate record                        |    1 | pre                       | KeyStateRecord                 |
| wits.    | .wits         | CesrIoSetSuber    | dgKey: list of witnesses for a given event; maps dg+SAID -> [witpre]                |    * | (pre, KEL evt SAID)       | [Prefixer (wits)]              |
| habs.    | .habs         | Komer             | Habitat records (controller databases)                                              |    1 | ns + b'\x00' + name       | HabitatRecord                  |
| names.   | .names        | Suber             | Habitat name database; maps (domain, name) -> Prefixer                              |    1 | (ns, name)                | pre                            |
| sdts.    | .sdts         | CesrSuber         | SAD support timestamps and signatures, indexed and non-indexed; maps SAID -> dt     |    1 | (said,)                   | dater                          |
| ssgs.    | .ssgs         | CesrIoSetSuber    | SAD indexed signatures; maps SAD quadkeys -> [Siger]                                |    * | (said, pre, snh, ssaid)   | [sigers]                       |
| scgs.    | .scgs         | CatcesrIoSetSuber | SAD non-indexed signatures; maps SAD SAID to couple of (Verfer, Cigar) NTSigs       |    * | (saider,)                 | [(verfer, cigar)]              |
| rpys.    | .rpys         | SerderSuber       | Reply '/rpy' messages. Uses .sdts, ssgs, and .scgs for datetimes and sigs           |    1 | (saider,)                 | SerderKERI                     |
| rpes.    | .repes        | CesrIoSetSuber    | Reply '/rpy' escrow indices of partially signed reply messages; Maps route->SAID    |    * | (route,)                  | [saider]                       |
| eans.    | .eans         | CesrSuber         | AuthN/AuthZ by local controller cid of endpoint provider at eid for 'role'          |    1 | (cid.role.eid)            | SAID                           |
| lans.    | .lans         | CesrSuber         | AuthN/AuthZ by endpoint provider at eid of location at scheme in URL                |    1 | (cid.role.eid)            | SAID                           |
| ends.    | .ends         | Komer             | Service endpoint identifier (eid) auths keyed by controller; extracted from rpy msg |    1 | (cid.role.eid)            | EndpointRecord                 |
| locs.    | .locs         | Komer             | Service endpoint locations keyed by eid.scheme                                      |    1 | (aid, scheme)             | LocationRecord                 |
| obvs.    | .obvs         | Komer             | Observed IDs (oid) keyed by cid (ctlr), aid (watchr), oid (obsv)                    |    1 | (cid.aid.oid)             | ObservedRecord                 |
| witm.    | .tops         | Komer             | Index of last retrieved message from witness mailbox                                |    1 | (pre, witpre)             | TopicsRecord                   |
| gpse.    | .gpse         | CatCesrIoSetSuber | Group partial signature escrow                                                      |    1 | (pre,)                    | (sn, said)                     |
| gdee.    | .gdee         | CatCesrIoSetSuber | Group delegate escrow                                                               |    1 | (pre,)                    | (sn, said)                     |
| gdwe.    | .gpwe         | CatCesrIoSetSuber | Group partial witness escrow                                                        |    1 | (pre,)                    | (sn, said)                     |
| cgms.    | .cgms         | CesrSuber         | snKey: Completed Group Multisig                                                     |    1 | (pre, sn)                 | saider                         |
| epse.    | .epse         | SerderSuber       | Exchange message partial signature escrow                                           |    1 | (dig,)                    | SerderKERI                     |
| epsd.    | .epsd         | CesrSuber         | Exchange message partial signature escrow date time of message                      |    1 | (dig,)                    | Dater                          |
| exns.    | .exns         | SerderSuber       | Exchange 'exn' messages                                                             |    1 | (dig,)                    | SerderKERI                     |
| erpy.    | .erpy         | CesrSuber         | Forward pointer to a provided reply message                                         |    1 | (pdig,)                   | said                           |
| esigs.   | .esigs        | CesrIoSetSuber    | Exchange message indexed signatures                                                 |    1 | (said, pre, snh, ssaid)   | Siger                          |
| ecigs.   | .ecigs        | CatCesrIoSetSuber | Exchange message non-indexed signatures                                             |    1 | (dig,)                    | (verfer, cigar)                |
| .epath   | .epath        | IoSetSuber        | Exchange message pathed attachments                                                 |    * | (dig,)                    | [bytes(path)]                  |
| .essars  | .essrs        | CesrIoSetSuber    | Encrypt Sender Sign Receiver (ESSR) messages                                        |    1 | (dig,)                    | Texter                         |
| chas.    | .chas         | CesrIoSetSuber    | Accepted, signed 12-word challenge response 'exn' messages keyed by signer prefix   |    1 | (sig,)                    | Saider                         |
| reps.    | .reps         | CesrIoSetSuber    | Successful, signed 12-word challenge response 'exn' messages keyed by signer prefix |    1 | (signer,)                 | Saider                         |
| wkas.    | .wkas         | IoSetKomer        | Authorized, well-known OOBIs                                                        |    1 | (cid,)                    | WellKnownAuthN                 |
| kdts.    | .kdts         | CesrSuber         | KSN date time stamps and signatures, indexed and non-indexed; maps SAID -> dt       |    1 | (saider,)                 | dater                          |
| ksns.    | .ksns         | Komer             | Key state messages. Maps key state SAID -> bytes; uses .kdts, .ksgs, and .kcgs      |    1 | (saider,)                 | KeyStateRecord                 |
| knas.    | .knas         | CesrSuber         | Key state SAID database for successful 'ksn' events; maps (pre, aid) -> SAID        |    1 | (ksr.i, aid)              | Saider                         |
| wwas.    | .wwas         | CesrSuber         | Watcher watched SAID db for successfully saved watched AIDs for a watcher           |    1 | (cid, aid, oid)           | Saider                         |
| oobis.   | .oobis        | Komer             | Config-loaded OOBIs to be processed asynchronously; keyed by OOBI URL               |    1 | OOBI URL                  | OobiRecord                     |
| eoobi.   | .eoobi        | Komer             | Escrow OOBIs that failed to load, retriable; keyed by OOBI URL                      |    1 | OOBI URL                  | OobiRecord                     |
| coobi.   | .coobi        | Komer             | OOBIs with outstanding client requests                                              |    1 | OOBI URL                  | OobiRecord                     |
| roobi.   | .roobi        | Komer             | Resolved OOBIs successfully processed                                               |    1 | OOBI URL                  | OobiRecord                     |
| woobi.   | .woobi        | Komer             | Well-known OOBIs to be used for MFA against a resolved OOBI                         |    1 | OOBI URL                  | OobiRecord                     |
| moobi.   | .moobi        | Komer             | Multi-OOBI where association is made between one AID and multiple OOBIs             |    1 | OOBI URL                  | OobiRecord                     |
| mfa.     | .mfa          | Komer             | Multifactor well-known OOBI authentication records to process; keyed by ctrlr URL   |    1 | controller URL            | OobiRecord                     |
| rmfa.    | .rmfa         | Komer             | Resolved multifactor well-known OOBI auth records; keyed by ctrlr URL               |    1 | controller URL            | OobiRecord                     |
| schema.  | .schema       | SchemerSuber      | JSONSchema SADs for ACDC schemas; keyed by the schema SAID                          |    1 | said                      | JSON (schema)                  |
| cfld.    | .cfld         | Suber             | Field values for contact information for remote identifiers; keyed by prefix/field  |    1 | (pre, field)              | JSON string data               |
| hbys.    | .hbys         | Suber             | Global settings for Habery environment                                              |    1 | name                      | pre                            |
| cons.    | .cons         | Suber             | Signed contact data; keyed by prefix                                                |    1 | (pre, )                   | byte(raw JSON)                 |
| ccigs.   | .ccigs        | CesrSuber         | Transferable signatures on contact data                                             |    1 | (pre,)                    | Cigar                          |
| imgs.    | .imgs         | LMDB              | Chunked image data of contact information for remote identifiers                    |    * | pre.idx, pre.content-type | type bytes, img bytes          |
| dpwe.    | .dpwe         | SerderSuber       | Delegation escrow for partially witnessed delegated events                          |    1 | (pre, said)               | SerderKERI                     |
| dune.    | .dune         | SerderSuber       | Delegation escrow for delegated unanchored events                                   |    1 | (pre, said)               | SerderKERI                     |
| dpub.    | .dpub         | SerderSuber       | Delegation escrow for delegate publication for sending delegator info to witnesses  |    1 | (pre, said)               | SerderKERI                     |
| cdel.    | .cdel         | CesrSuber         | Completed group delegated AIDs                                                      |    1 | (pre, sn)                 | Saider                         |
| meids.   | .meids        | CesrIOSetSuber    | Multisig embed paypoad SAID -> containing EXN messages across participants          |    1 | (said,)                   | Saider                         |
| maids.   | .maids        | CesrIoSetSuber    | Multisig embed payload SAID -> group multisig participant AIDs                      |    1 | (said,)                   | Prefixer                       |
```

## Reger

```org
** Reger (65) - stores TEL registry messages
  DB: reg
  Path: keri/reg
  | LMDB key  | Reger DB prop    | db-class          | value schema               | description                                                                                | Mult | Key schema                 |
  |-----------+------------------+-------------------+----------------------------+--------------------------------------------------------------------------------------------+------+----------------------------|
  | tvts.     | .tvts            | LMDB              | SerderKERI                 | dgKey: serialized TEL events                                                               |    1 | (pre, evt digest)          |
  | tels.     | .tels            | LMDB              | SAID of ^ (SerderKERI)     | snKey: TEL tables mapping sn -> evt digest                                                 |    1 | (pre, sn TEL vet)          |
  | ancs.     | .ancs            | LMDB              | (Seqner, Saider)           | dgKey: anchors to KEL events (sn, dig) that anchor iss or rev evts                         |    1 | (pre, evt digest)          |
  | tibs.     | .tibs            | LMDB dups         | [Siger (indexed)]          | dgKey: indexed backer sigs (index=offset in backer list)                                   |    * | (pre, evt digest)          |
  | baks.     | .baks            | LMDB dups         | [Backer AIDs (wits)]       | dgKey: ordered list of bakers at given point in mgt TEL                                    |    * | (pre, evt digest)          |
  | oots.     | .oots            | LMDB              | SAIDb (bytes) of TEL evt   | snKey: out of order escrowed evt tables: sn -> evt digest                                  |    1 | (pre, sn KEL evt)          |
  | twes.     | .twes            | LMDB              | SAIDb (bytes) of TEL evt   | snKey: partial-witnessed escrowed TEL evt tables: sn -> evt digest                         |    1 | (pre, sn TEL evt)          |
  | taes.     | .taes            | LMDB              | SAIDb (bytes) of TEL evt   | snKey: anchorless escrowed TEL evt tables: sn -> evt digest                                |    1 | (pre, sn TEL evt)          |
  | tets.     | .tets            | CesrSuber         | Dater                      | dgKey: TEL event timestamps. Apparently not used.                                          |    1 | (pre, evt digest)          |
  | stts.     | .states          | Komer             | RegStateRecord             | name: reg Identifier: RegStateRecord                                                       |    1 | reg evt SAID               |
  | creds.    | .creds           | SerderSuber       | SerderACDC                 | said: Stores credentials keyed by credential SAID                                          |    1 | cred SAID                  |
  | cancs.    | .cancs           | CatCesrSuber      | (Prefixer, Seqner, Saider) | said: Anchors to credentials, keyed by credential SAID                                     |    1 | cred SAID                  |
  | ssgs.     | .spsgs           | CesrIoSetSuber    | Siger                      | sad-pathed indexed signatures; SAD quinkey -> Siger (trans)                                |    ? | (SAID, path, pre, sn, dig) |
  | scgs.     | .spcgs           | CatCesrIoSetSuber | (Verfer, Cigar)            | sad-pathed non-indexed signatures; SAD couple -> (Verfer, Siger) (non-trans)               |    ? |                            |
  | saved.    | .saved           | CesrSuber         | Saider                     | Index of creds processed + saved. Indicates fully verified, even if revoked                |    1 | saider.qb64                |
  | issus.    | .issus           | CesrDupSuber      | Saider                     | Index of creds by issuer. My credentials issued, key == hab.pre                            |    * | pre                        |
  | subjs.    | .subjs           | CesrDupSuber      | Saider                     | Index of creds by subject. My credentials received, key == hab.pre                         |    * | pre                        |
  | schms.    | .schms           | CesrDupSuber      | Saider                     | Index of credentials by schema. Key == schema SAID                                         |    * | SAID of schema             |
  | mre.      | .mre             | CesrSuber         | Dater                      | Missing registry escrow                                                                    |    1 | SAID of cred               |
  | mce.      | .mce             | CesrSuber         | Dater                      | Broken chain escrow                                                                        |    1 | SAID of cred               |
  | mse.      | .mse             | CesrSuber         | Dater                      | Missing schema escrow                                                                      |    1 | SAID of cred               |
  | txn.      | .txnsb           | Broker            | multi (see below)          | Collection of sub-dbs for persisting Registry Txn State Notices                            |  N/A | N/A                        |
  | txn.-dts. | .txnsb.daterdb   | CesrSuber         | Dater                      | State support datetime stamps and signatures, indexed and non-indexed, ksns                |    1 | (SAID,)                    |
  | txn.-sns. | .txnsdb.serderdb | SerderSuber       | Reply 'rpy' msg SerderKERI | All Reply 'rpy' messages holding key state messages. rpy SAID -> serder                    |    1 | (SAID,)                    |
  | txn.-sgs. | .txnsdb.tigerdb  | CesrIoSetSuber    | Siger                      | ksn indexed sigs; maps ksn quadkey -> est evt signers                                      |    * | (SAID, pre, sn, dig)       |
  | txn.-cgs. | .txnsdb.cigardb  | CatCesrIoSetSuber | Cigar                      | ksn non-indexed sigs; maps ksn SAID -> (Verfer, Cigar) of non-trans signers                |    * | (SAID,)                    |
  | txn.-nes  | .txnsdb.escrowdb | CesrIoSetSuber    | Saider                     | Key state escrow indices of partially signed KSN; maps reply route -> SAID of escrowed ksn |   *1 | (typ, pre, aid)            |
  | txn.-nas. | .txnsdb.saiderdb | CesrSuber         | Saider                     | Successful TSN tx state db; maps (issuer prefix, aid) -> SAID of tx state                  |    1 | (rpy iss pre, aid)         |
  | regs.     | .regs            | Komer             | RegistryRecord             | habitat name str is key: registry name -> registry record                                  |    1 | name                       |
  | tpwe.     | .tpwe            | CatCesrIoSetSuber | (Prefixer, Seqner, Saider) | TEL partial witness escrow                                                                 |    * | (regk, sn)                 |
  | tmse.     | .tmse            | CatCesrIoSetSuber | (Prefixer, Seqner, Saider) | TEL multisig anchor escrow. Regd is SAID of vcp evt                                        |    * | (regk, sn, regd)           |
  | tede.     | .tede            | CatCesrIoSetSuber | (Prefixer, Seqner, Saider) | TEL event dissemination escrow                                                             |    * | (regk, sn)                 |
  | ctel.     | .ctel            | CesrSuber         | Saider                     | Completed TEL event                                                                        |    1 | (regk, sn)                 |
  | cmse.     | .cmse            | SerderSuber       | SerderACDC                 | Credential Missing Signature Escrow                                                        |    1 | (cred SAID, sn)            |
  | ccrd.     | .ccrd            | SerderSuber       | SerderACDC                 | Completed Credentials                                                                      |    1 | (cred SAID)                |
  |           |                  |                   |                            |                                                                                            |      |                            |

```

## Keeper

```org
** Keeper (6) (-4)
Keeper stores key pairs and provides methods for key pair creation, storage, and data signing.
DB: ks
Path: keri/ks
| LMDB key | Keeper DB prop | db-class          | description                                                | Mult | Key schema       | value schema       |
|----------+----------------+-------------------+------------------------------------------------------------+------+------------------+--------------------|
| gbls.    | .glbs          | Suber             | Global parameters for all prefixes. param label -> param   |    1 | (pre, evt SAID)  | raw SerderKERI     |
|          |                |                   | Params: aeid, pidx, algo, salt, tier                       |      |                  |                    |
| pris.    | .pris          | CryptSignerSuber  | pubkey -> privkey                                          |    1 | qb64: public key | qb64: private key  |
| * prxs.  | .prxs          | CesrSuber         | Not yet used by KERIpy, added by Phil for GroupSignifyHab  |    ? | ?                | Cipher             |
| * nxts.  | .nxts          | CesrSuber         | Not yet used by KERIpy, added by Phil for GroupSignifyHab  |    ? | ?                | Cipher             |
| * smids. | .smids         | CatCesrIoSetSuber | Not yet used by KERIpy, added by Phil for GroupSignifyHab  |    ? | ?                | (Prefixer, Seqner) |
| * rmids. | .rmids         | CatCesrIoSetSuber | Not yet used by KERIpy, added by Phil for GroupSignifyHab  |    ? | ?                | (Prefixer, Seqner) |
| pres.    | .pres          | Cesrsuber         | Index of keys to pre; 1stpubkey -> prefix/1stpubkey(temp)  |    1 | qb64: 1stpubkey  | qb64: pre/1stpub   |
| prms.    | .prms          | Komer             | Key parameters; pre -> PrePrm                              |    1 | qb64: pre        | PrePrm             |
| sits.    | .sits          | Komer             | Key situations; pre -> PreSit                              |    1 | qb64: pre        | PreSit             |
| pubs.    | .pubs          | Komer             | Index of pubkeys by pre & ridx for replay in est evt order |    1 | riKey: (pre, ri) | PubSet             |

- * = not used, do not count; likely can be taken out

Remember to explain the use of the AEID with the Encrypter and Decrypter for storing private key material and whatever else is securely stored.
- Only salts and private keys are encrypted.

```

## Noter

```org
** Noter (3)
Noter stores Notifications generated by the agent that are intended to be read and sismissed by the controller of the agent.
DB: not
Path: keri/not
| LMDB key | Noter DB prop | db-class    | description                                                     | Mult | Key schema | value schema  |
|----------+---------------+-------------+-----------------------------------------------------------------+------+------------+---------------|
| nots.    | .notes        | DigterSuber | Stores Notice (notification) objects                            |    1 | (dt, rid)  | Notice        |
| nidx.    | .nidx         | Suber       | Stores datetimes that Notice objects were added to the database |    1 | (rid,)     | datetimestamp |
| ncigs.   | .ncigs        | CesrSuber   | Stores signatures of Notice objects                             |    1 | (rid,)     | Cigar         |

- Data Structures
  - Notification (notifying.notice function)
    #+begin_src json
    {
      "i": "issuer or creator of notification; a SAID field from Saids.i",
      "a": {
      },
      "dt": "ISO 8601 datetimestamp",
      "r": "boolean value, is true or false if read or not",
      "rid": "random ID of note; based on note label (defaults to 'i')"
    }
    #+end_src
  - RID: random ID (basically the "i" prop of a Notice)
  - datetimestamp
  - Cigar
```

## Mailboxer

```org
** Mailboxer (2)
Mailboxer stores exn messages in order and provides iterator access at an index.
DB: mbx (mailbox)
Path: keri/mbx
| key   | value schema                   | db-class     | values | description                                     | Mult  | Key schema |
|-------+--------------------------------+--------------+--------+-------------------------------------------------+-------+------------|
| tpcs. | Blake3 digest of EXN message   | Plain LMDB   |        | An index by topic of EXN message digests        | *(on) | topic      |
| msgs. | Sadder.raw+atc, Serder.raw+atc | subing.Suber |        | EXN messages (CESR streams) of messages to send | 1     | digest     |

| topic           | Handler        | values | comments                                                                |
|-----------------+----------------+--------+-------------------------------------------------------------------------|
| recipient/topic | ForwardHandler |        | recipient is serder.ked['q']['pre'], topic is ['q']['topic'] if present |
| /fwd            | ForwardHandler |        | /fwd schema: (src, dest, topic, serder, attachment?, hab?)              |
|                 |                |        |                                                                         |
|                 |                |        |                                                                         |
    
- When a mailbox message is received a digest is made goes in the "tpcs." database and is appended with an auto-generated, insertion-ordered key
  like so: tpcs.receipt.00000000000000000000000000000000 or tpcs.receipt.001 (abbreviated) into the LMDB database, now an OnSuber database,
  and the EXN message body is stored in the "msgs." Suber database.

  This stores first seen messages where the first seen logic depends on the "fn" arg defaulting to zero.
  There could be other events stored, as they are appended to a topic based on the topic name and not an order number.
  There may be storage-based DOS attack here by allowing storage of arbitrary events, though it is a minor attack vector.
    
```