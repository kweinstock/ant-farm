// Takes the TESTING environment down for good, so it stops running the colony
// and stops spending requests once production is live:
//
//   npm run teardown:testing -- --dry-run     (prints the plan, runs nothing)
//   npm run teardown:testing                  (asks you to type the Worker's name first)
//
// What it does, in order:
//
//   1. Deploys a tiny stand-in over `ant-farm-testing` — no Durable Object
//      binding, every request answered "410 Gone" — together with a migration
//      that DELETES the ColonyDO class. That is Cloudflare's documented way to
//      remove a Durable Object: it drops the object and its saved colony, which
//      also cancels its alarms. After this step nothing ticks any more.
//   2. Deletes the Worker itself (`wrangler delete`).
//   3. Fetches the testing URL and prints what comes back, so you can see it is gone.
//
// It is NOT undoable: the testing colony and its saved state are destroyed. The
// production Worker (`ant-farm`) is never touched — the script refuses any name
// that isn't a "-testing" Worker.
//
// Things this script cannot do for you (it prints them again at the end):
//   - Cloudflare Workers Builds deploys a Worker per branch. If the `testing`
//     branch is connected there, the next push to it would build the testing
//     Worker again — disconnect that branch in the dashboard (or stop pushing it).
//   - Remove the `env.testing` block from wrangler.jsonc and the
//     `deploy:testing` npm script once you are done with the testing side.
//
// Needs `npx wrangler login` to have been done (it uses your own login; nothing
// is stored here). Run it yourself — it deploys and deletes on your account.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const DEFAULT_NAME = "ant-farm-testing";
const PRODUCTION_NAME = "ant-farm";
const TESTING_URL = "https://testing.kweinstock.dev/ant-farm/api/stream";
const WORK_DIR = resolve(".wrangler", "teardown-testing"); // .wrangler is gitignored

const argv = process.argv.slice(2);
const flag = (name: string): boolean => argv.includes(`--${name}`);
function flagValue(name: string): string | undefined {
    const index = argv.findIndex((arg) => arg === `--${name}` || arg.startsWith(`--${name}=`));
    if (index === -1) return undefined;
    const arg = argv[index];
    return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[index + 1];
}

const dryRun = flag("dry-run");
const assumeYes = flag("yes");
const skipStandIn = flag("skip-stand-in"); // only if step 1 already ran, or the Worker has no Durable Object
const workerName = flagValue("name") ?? DEFAULT_NAME;

// ---- guards: this must never be able to hit production ----
if (!/^[a-z0-9-]+$/.test(workerName)) {
    fail(`"${workerName}" is not a valid Worker name.`);
}
if (workerName === PRODUCTION_NAME || !workerName.endsWith("-testing")) {
    fail(`Refusing to tear down "${workerName}": only Workers named "...-testing" are allowed (never "${PRODUCTION_NAME}").`);
}

function fail(message: string): never {
    console.error(`[teardown-testing] ${message}`);
    process.exit(1);
}

function compatibilityDate(): string {
    const text = readFileSync("wrangler.jsonc", "utf8");
    const match = /"compatibility_date"\s*:\s*"([^"]+)"/.exec(text);
    if (!match) fail('Could not read "compatibility_date" from wrangler.jsonc.');
    return match[1];
}

// The stand-in Worker: same name and route as the real one, but it cannot run
// the sim — there is no Durable Object class in it at all.
function standInConfig(): string {
    return JSON.stringify(
        {
            name: workerName,
            main: "worker.js",
            compatibility_date: compatibilityDate(),
            routes: [{ pattern: "testing.kweinstock.dev/ant-farm/*", zone_name: "kweinstock.dev" }],
            // No durable_objects binding. The history has to be here so Cloudflare
            // can see v2 is new; v2 deletes the class and everything stored in it.
            migrations: [
                { tag: "v1", new_sqlite_classes: ["ColonyDO"] },
                { tag: "v2", deleted_classes: ["ColonyDO"] },
            ],
        },
        null,
        2,
    );
}

const STAND_IN_WORKER = `// Temporary stand-in written by scripts/teardown-testing.ts. Does nothing but say "gone".
export default {
    fetch() {
        return new Response("The testing colony has been taken down.", { status: 410 });
    },
};
`;

function run(description: string, args: string[]): boolean {
    const shown = `npx wrangler ${args.join(" ")}`;
    console.log(`\n> ${shown}`);
    if (dryRun) {
        console.log(`  (dry run — not executed) ${description}`);
        return true;
    }
    // shell: true so `npx` resolves on Windows (npx.cmd); every argument here is a
    // fixed string or the validated Worker name above.
    const result = spawnSync("npx", ["wrangler", ...args], { stdio: "inherit", shell: true });
    return result.status === 0;
}

async function confirm(): Promise<void> {
    if (assumeYes || dryRun) return;
    console.log(`\nThis will PERMANENTLY delete the Worker "${workerName}" and its saved colony.`);
    console.log(`Production ("${PRODUCTION_NAME}") is not touched.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Type the Worker's name (${workerName}) to continue: `)).trim();
    rl.close();
    if (answer !== workerName) fail("Name did not match — nothing was changed.");
}

async function main(): Promise<void> {
    console.log(`[teardown-testing] target: ${workerName}${dryRun ? "  (DRY RUN)" : ""}`);
    await confirm();

    if (!skipStandIn) {
        console.log("\nStep 1/3 — replace the Worker with a stand-in and delete its Durable Object (stops the simulation)");
        if (!dryRun) {
            rmSync(WORK_DIR, { recursive: true, force: true });
            mkdirSync(WORK_DIR, { recursive: true });
            writeFileSync(join(WORK_DIR, "wrangler.jsonc"), standInConfig());
            writeFileSync(join(WORK_DIR, "worker.js"), STAND_IN_WORKER);
        } else {
            console.log(`  would write ${join(WORK_DIR, "wrangler.jsonc")} and worker.js:\n${standInConfig().replace(/^/gm, "    ")}`);
        }
        const ok = run("deploys the stand-in + the delete-class migration", ["deploy", "--config", join(WORK_DIR, "wrangler.jsonc")]);
        if (!ok) {
            fail("Step 1 failed, so the Worker was NOT deleted (it may still be running the colony). Fix the error above and run again.");
        }
    } else {
        console.log("\nStep 1/3 — skipped (--skip-stand-in)");
    }

    console.log("\nStep 2/3 — delete the Worker");
    if (!run("removes the Worker script (and its routes/bindings) from your account", ["delete", "--name", workerName])) {
        fail("Step 2 failed. The simulation is already stopped (step 1), but the stand-in Worker still exists. Re-run with --skip-stand-in once the error is fixed.");
    }

    console.log("\nStep 3/3 — check the testing URL");
    if (dryRun) {
        console.log(`  (dry run) would request ${TESTING_URL}`);
    } else {
        try {
            const response = await fetch(TESTING_URL, { redirect: "manual" });
            const body = (await response.text()).slice(0, 80).replace(/\s+/g, " ");
            console.log(`  ${response.status} ${response.statusText} — "${body}"`);
            console.log("  Expected now: NOT the colony. A 410 means the stand-in is still routed; a 404/landing page means it is gone.");
        } catch (error) {
            console.log(`  request failed (${(error as Error).message}) — that also means nothing is serving it.`);
        }
    }

    console.log("\nDone. Still to do by hand:");
    console.log("  1. Cloudflare dashboard -> Workers & Pages: confirm ant-farm-testing is gone, and under the");
    console.log("     kweinstock.dev zone -> Workers Routes: no route for testing.kweinstock.dev/ant-farm/* remains.");
    console.log("  2. If Workers Builds is connected to the `testing` branch, disconnect it (otherwise the next push");
    console.log("     to that branch builds the testing Worker again).");
    console.log("  3. Remove the env.testing block from wrangler.jsonc and the deploy:testing script from package.json.");
}

void main();
