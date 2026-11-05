import { Prefixer, Saider } from "cesr-ts";
import {
  groupSigningMembers,
  type Hab,
  type Habery,
  isLocalGroupHab,
  latestGroupContribution,
  ValidationError,
} from "keri-ts/runtime";

/** The caller supplies the preceding roster and registries; neither is discovered or persisted here. */
export interface SelectNewcomerCopiesOptions {
  hby: Habery;
  group: Hab;
  rotation: string;
  previousSigningMembers: readonly string[];
  registries: readonly string[];
}

/** One explicit existing-root copy for a current signing member newly added by the selected rotation. */
export interface NewcomerCopy {
  registry: string;
  recipient: string;
  target: string;
  coordinator: string;
}

/** Select current signing newcomers, excluding members present only in next-key commitments. */
export function selectNewcomerCopies(
  { hby, group, rotation, previousSigningMembers, registries }: SelectNewcomerCopiesOptions,
): NewcomerCopy[] {
  if (group.db !== hby.db || !isLocalGroupHab(hby, group)) {
    throw new ValidationError("Newcomer copies require a local group habitat");
  }
  const state = group.kever, event = hby.db.getEvtSerder(group.pre!, rotation);
  if (
    !state || !event || !["rot", "drt"].includes(event.ilk!) || event.said !== state.lastEst.d
    || event.sn !== state.lastEst.s || hby.db.kels.getLast(group.pre!, event.sn!) !== rotation
  ) {
    throw new ValidationError("Selected rotation must be the accepted current group establishment");
  }
  if (!previousSigningMembers.length || !registries.length) {
    throw new ValidationError("Explicit previous signing members and registries are required");
  }
  for (const member of previousSigningMembers) {
    if (new Prefixer({ qb64: member }).qb64 !== member) throw new ValidationError("Invalid previous member AID");
  }
  for (const registry of registries) {
    if (new Saider({ qb64: registry }).qb64 !== registry) throw new ValidationError("Invalid registry SAID");
  }
  if (
    new Set(previousSigningMembers).size !== previousSigningMembers.length
    || new Set(registries).size !== registries.length
  ) {
    throw new ValidationError("Previous members and registry selections must not contain duplicates");
  }
  const members = groupSigningMembers(hby, group.pre!);
  if (
    members.length !== state.verfers.length || new Set(members).size !== members.length
    || members.some((member, index) => latestGroupContribution(hby.db, member, state.verfers)?.index !== index)
  ) {
    throw new ValidationError("Current signing membership must match the accepted group establishment");
  }
  const prior = new Set(previousSigningMembers);
  return members.filter(member => !prior.has(member)).flatMap(target =>
    registries.map(registry => ({
      registry,
      recipient: group.pre!,
      target,
      coordinator: rotation,
    }))
  );
}
