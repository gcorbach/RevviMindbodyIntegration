import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const prototypeRoutePattern = /(\[functions\.prototype-appointment-[^\]]+\]\s+)enabled = false/g;

export function resolveBundledSupabaseBinary(projectRoot) {
  const override = process.env.SUPABASE_CLI_BINARY_OVERRIDE;
  if (override && existsSync(override)) return override;

  const candidates = {
    darwin: { arm64: ["darwin-arm64"], x64: ["darwin-x64"] },
    linux: { arm64: ["linux-arm64", "linux-arm64-musl"], x64: ["linux-x64", "linux-x64-musl"] },
    win32: { arm64: ["windows-arm64"], x64: ["windows-x64"] },
  }[process.platform]?.[process.arch] ?? [];
  const requireFromSupabase = createRequire(realpathSync(join(projectRoot, "node_modules", "supabase", "dist", "supabase.js")));
  for (const suffix of candidates) {
    try {
      const packageRoot = dirname(requireFromSupabase.resolve(`@supabase/cli-${suffix}/package.json`));
      return join(packageRoot, "bin", process.platform === "win32" ? "supabase.exe" : "supabase");
    } catch {}
  }
  throw new Error(`No bundled Supabase CLI binary is available for ${process.platform}-${process.arch}.`);
}

export function createAppointmentPrototypeProject(projectRoot) {
  const productionConfig = readFileSync(join(projectRoot, "supabase", "config.toml"), "utf8");
  if ((productionConfig.match(prototypeRoutePattern) ?? []).length !== 9) {
    throw new Error("Expected every Appointment prototype route to be disabled in production configuration.");
  }

  const prototypeProject = mkdtempSync(join(tmpdir(), "revvi-appointment-prototype-"));
  try {
    const prototypeSupabase = join(prototypeProject, "supabase");
    mkdirSync(prototypeSupabase, { recursive: true });
    symlinkSync(join(projectRoot, "supabase", "functions"), join(prototypeSupabase, "functions"), process.platform === "win32" ? "junction" : "dir");
    writeFileSync(join(prototypeSupabase, "config.toml"), productionConfig.replace(prototypeRoutePattern, "$1enabled = true"));
  } catch (error) {
    rmSync(prototypeProject, { recursive: true, force: true });
    throw error;
  }

  return {
    path: prototypeProject,
    remove() {
      rmSync(prototypeProject, { recursive: true, force: true });
    },
  };
}
