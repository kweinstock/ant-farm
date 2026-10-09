// Names are cosmetic and must never influence the simulation. In particular
// nothing here may draw from the sim's RNG stream (state.rngSeed): taking a
// number from it would shift every later roll and change the whole run that
// params.ts was tuned against. The given name is therefore a pure hash of the
// ant's id — same id, same name, in every run and on every replay.
//
// The surname is not chosen here. It is inherited (see the surname queue in
// state.ts / index.ts); this file only builds and splits full names.
import { GIVEN_NAMES, SURNAMES } from "./wordlists";
import { AntId } from "../ants/ant";
import { SurnameVacancy } from "../state";

export const SURNAME_QUEUE_CAP = 50;
export const HEIRS_CAP = 200;

function hashId(id: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < id.length; i++) {
        hash ^= id.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

export function givenNameFor(antId: string): string {
    return GIVEN_NAMES[hashId(antId) % GIVEN_NAMES.length];
}

export function founderSurname(index: number): string {
    return SURNAMES[index % SURNAMES.length];
}

export function fullName(given: string, surname: string): string {
    return `${given} ${surname}`;
}

export function surnameOf(name: string): string {
    const space = name.lastIndexOf(" ");
    return space === -1 ? name : name.slice(space + 1);
}

export function queueSurname(queue: SurnameVacancy[], deadId: AntId, name: string): SurnameVacancy[] {
    const next = [...queue, { deadId, surname: surnameOf(name) }];
    return next.length > SURNAME_QUEUE_CAP ? next.slice(next.length - SURNAME_QUEUE_CAP) : next;
}

export function claimSurname(queue: SurnameVacancy[], heirs: Record<AntId, AntId>, newId: AntId): { surname: string; queue: SurnameVacancy[]; heirs: Record<AntId, AntId> } {
    if (queue.length === 0) {
        return { surname: founderSurname(0), queue, heirs };
    }
    const [oldest, ...rest] = queue;
    const nextHeirs = { ...heirs, [oldest.deadId]: newId };
    const keys = Object.keys(nextHeirs);
    for (let i = 0; i < keys.length - HEIRS_CAP; i++) delete nextHeirs[keys[i]];
    return { surname: oldest.surname, queue: rest, heirs: nextHeirs };
}