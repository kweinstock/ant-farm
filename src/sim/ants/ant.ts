import type { Position } from "../world/grid";

const STARTING_ENERGY = 1500;
export const MAX_ENERGY = 1500;

export type AntId = string;
export type Caste = "QUEEN" | "WORKER";
export type Job = "NURSE" | "FORAGER";

export type Ant = {
    id: AntId;
    name: string;
    caste: Caste;
    job: Job;
    position: Position;
    energy: number;
    ageTicks: number;
    lifespanTicks: number;
};

export function createWorker(id: AntId, position: Position, lifespanTicks: number): Ant {
    return {
        id,
        name: id,
        caste: "WORKER",
        job: "NURSE",
        position,
        energy: STARTING_ENERGY,
        ageTicks: 0,
        lifespanTicks,
    };
}

export function createQueen(id: AntId, position: Position, lifespanTicks: number): Ant {
    return {
        id,
        name: id,
        caste: "QUEEN",
        job: "NURSE",
        position,
        energy: STARTING_ENERGY,
        ageTicks: 0,
        lifespanTicks,
    };
}