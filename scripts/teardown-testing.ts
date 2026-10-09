// Takes the TESTING colony down for good — so it stops running the simulation and
// stops spending requests once production is live — but leaves a small page at the
// testing address that says "Testing is not in progress", so a visitor doesn't just
// hit a 404:
//
//   npm run teardown:testing -- --dry-run     (prints the plan, runs nothing)
//   npm run teardown:testing                  (asks you to type the Worker's name first)
//   npm run teardown:testing -- --delete      (also deletes the Worker afterwards: back to a bare 404)
//
// What it does:
//
//   1. Deploys a tiny stand-in over `ant-farm-testing`: no Durable Object binding,
//      and every page request answered with the "Testing is not in progress" page.
//      The same deploy carries a migration that DELETES the ColonyDO class — that is
//      Cloudflare's documented way to remove a Durable Object: it drops the object
//      and its saved colony, which also cancels its alarms. After this nothing ticks.
//   2. Fetches the testing URL and prints what comes back, so you can see the page.
//   3. With --delete only: deletes the Worker itself (`wrangler delete`).
//
// It is NOT undoable: the testing colony and its saved state are destroyed. The
// production Worker (`ant-farm`) is never touched — the script refuses any name
// that isn't a "-testing" Worker.
//
// Cost afterwards: a visit to the testing address is one tiny Worker request (it
// serves a fixed page); nothing runs on its own.
//
// Things this script cannot do for you (it prints them again at the end):
//   - Cloudflare Workers Builds deploys a Worker per branch. If the `testing`
//     branch is connected there, the next push to it would build the real app over
//     this page — disconnect that branch in the dashboard (or stop pushing it).
//   - Remove the `env.testing` block from wrangler.jsonc and the
//     `deploy:testing` npm script once you are done with the testing side.
//
// Needs `npx wrangler login` to have been done (it uses your own login; nothing
// is stored here). Run it yourself — it deploys on your account.
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

const DEFAULT_NAME = "ant-farm-testing";
const PRODUCTION_NAME = "ant-farm";
const PRODUCTION_URL = "https://kweinstock.dev/ant-farm/";
const TESTING_URL = "https://testing.kweinstock.dev/ant-farm/";
const MARKER = "Testing is not in progress"; // what the page says; also what the check looks for
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
const alsoDelete = flag("delete"); // delete the Worker too (no page left behind)
// The Durable Object is already gone (or never existed): deploy only the page, with no
// delete-class migration. Use after a teardown that removed the Worker.
const pageOnly = flag("page-only");
const workerName = flagValue("name") ?? DEFAULT_NAME;

// ---- guards: this must never be able to hit production ----
if (!/^[a-z0-9-]+$/.test(workerName)) {
    fail(`"${workerName}" is not a valid Worker name.`);
}
if (pageOnly && alsoDelete) {
    fail("--page-only and --delete contradict each other.");
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

// The stand-in's configuration: same name and route as the real testing Worker,
// but no Durable Object binding — so it cannot run the simulation.
function standInConfig(): string {
    return JSON.stringify(
        {
            name: workerName,
            main: "worker.js",
            compatibility_date: compatibilityDate(),
            routes: [{ pattern: "testing.kweinstock.dev/ant-farm/*", zone_name: "kweinstock.dev" }],
            // The history has to be listed so Cloudflare can see v2 is the new one;
            // v2 deletes the class and everything stored in it.
            ...(pageOnly
                ? {}
                : {
                    migrations: [
                        { tag: "v1", new_sqlite_classes: ["ColonyDO"] },
                        { tag: "v2", deleted_classes: ["ColonyDO"] },
                    ],
                }),
        },
        null,
        2,
    );
}

// Same palette as the app (dark brown, gold accent), no JavaScript, no external requests.
const PAGE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Global Ant Farm</title>
<style>
  html, body { margin: 0; height: 100%; }
  body {
    display: flex; align-items: center; justify-content: center; padding: 1.5rem; box-sizing: border-box;
    background: radial-gradient(ellipse at 50% 40%, #2a2014 0%, #1a140c 70%);
    color: #f0e6d2; font: 15px/1.6 sans-serif; text-align: center;
  }
  main { max-width: 26rem; }
  h1 { margin: 0; font: 1.7rem/1.2 Georgia, "Times New Roman", serif; }
  .pill {
    display: inline-block; margin-top: 1rem; padding: 0.2rem 0.9rem; border-radius: 999px;
    background: rgba(200, 184, 152, 0.18); color: #e6d9bd; font-size: 0.8rem;
    letter-spacing: 0.08em; text-transform: uppercase;
  }
  p { margin: 1.2rem 0 0; color: #e6d9bd; }
  a {
    display: inline-block; margin-top: 1.4rem; padding: 0.55rem 1.2rem; border-radius: 10px;
    border: 1px solid rgba(200, 184, 152, 0.5); background: rgba(240, 230, 210, 0.1);
    color: #f0e6d2; text-decoration: none;
  }
  a:hover { background: rgba(240, 230, 210, 0.2); }
</style>
</head>
<body>
<main>
  <h1>Global Ant Farm</h1>
  <div class="pill">${MARKER}</div>
  <p>This is the testing address, and nothing is running here right now. The live colony is on the main site.</p>
  <a href="${PRODUCTION_URL}">Go to the live colony</a>
</main>
</body>
</html>
`;

// The stand-in Worker: the page for everything, except the colony's old stream
// endpoint (an old open tab asking for it should just get a plain 404).
const STAND_IN_WORKER = `// Temporary stand-in written by scripts/teardown-testing.ts.
const PAGE = ${JSON.stringify(PAGE_HTML)};

export default {
    fetch(request) {
        const { pathname } = new URL(request.url);
        if (pathname.startsWith("/ant-farm/api/")) {
            return new Response("Not found", { status: 404 });
        }
        return new Response(PAGE, {
            status: 200,
            headers: {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "public, max-age=300",
                "x-robots-tag": "noindex",
            },
        });
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
    console.log(`\nThis will PERMANENTLY delete the testing colony ("${workerName}") and its saved state,`);
    console.log(alsoDelete
        ? "and then delete the Worker too (the testing address will be a bare 404)."
        : `and leave a "${MARKER}" page at the testing address.`);
    console.log(`Production ("${PRODUCTION_NAME}") is not touched.`);
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = (await rl.question(`Type the Worker's name (${workerName}) to continue: `)).trim();
    rl.close();
    if (answer !== workerName) fail("Name did not match — nothing was changed.");
}

async function main(): Promise<void> {
    console.log(`[teardown-testing] target: ${workerName}${dryRun ? "  (DRY RUN)" : ""}`);
    await confirm();

    const steps = alsoDelete ? 3 : 2;

    console.log(`\nStep 1/${steps} — deploy the "${MARKER}" page and delete the Durable Object (stops the simulation)`);
    if (!dryRun) {
        rmSync(WORK_DIR, { recursive: true, force: true });
        mkdirSync(WORK_DIR, { recursive: true });
        writeFileSync(join(WORK_DIR, "wrangler.jsonc"), standInConfig());
        writeFileSync(join(WORK_DIR, "worker.js"), STAND_IN_WORKER);
    } else {
        console.log(`  would write ${join(WORK_DIR, "wrangler.jsonc")} and worker.js (the page, ${PAGE_HTML.length} bytes of HTML):\n${standInConfig().replace(/^/gm, "    ")}`);
    }
    if (!run("deploys the page + the delete-class migration", ["deploy", "--config", join(WORK_DIR, "wrangler.jsonc")])) {
        fail("Step 1 failed — the testing colony may still be running. Fix the error above and run again.");
    }

    console.log(`\nStep 2/${steps} — check the testing URL`);
    if (dryRun) {
        console.log(`  (dry run) would request ${TESTING_URL} and look for "${MARKER}"`);
    } else {
        try {
            const response = await fetch(TESTING_URL, { redirect: "manual" });
            const text = await response.text();
            const ok = response.status === 200 && text.includes(MARKER);
            console.log(`  ${response.status} ${response.statusText} — ${ok ? `shows "${MARKER}"` : "this is NOT the page (the route may take a minute to update; check again, or look at the dashboard)"}`);
        } catch (error) {
            console.log(`  request failed (${(error as Error).message}) — check the dashboard.`);
        }
    }

    if (alsoDelete) {
        console.log(`\nStep 3/${steps} — delete the Worker`);
        if (!run("removes the Worker script (and its routes/bindings) from your account", ["delete", "--name", workerName])) {
            fail("Delete failed. The simulation is already stopped; the page Worker still exists. Re-run `wrangler delete --name " + workerName + "` once the error is fixed.");
        }
    }

    console.log("\nDone. Still to do by hand:");
    console.log("  1. Cloudflare dashboard -> Workers & Pages: confirm the DO is gone (the Worker should have no Durable Object binding)");
    console.log("     and check Observability shows no alarm invocations for ant-farm-testing any more.");
    console.log("  2. If Workers Builds is connected to the `testing` branch, disconnect it (otherwise the next push");
    console.log("     to that branch builds the real app over this page again).");
    console.log("  3. Remove the env.testing block from wrangler.jsonc and the deploy:testing script from package.json.");
}

void main();
