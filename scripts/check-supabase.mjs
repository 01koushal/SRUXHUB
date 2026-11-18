import fs from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");

console.log("=== Supabase Diagnostic ===");
console.log("Working directory:", process.cwd());
console.log(".env exists:", fs.existsSync(envPath));

if (!fs.existsSync(envPath)) {
  console.error("❌ .env file not found in project root");
  process.exit(1);
}

const envText = fs.readFileSync(envPath, "utf8");

function readEnv(name) {
  const match = envText.match(
    new RegExp(`^\\s*${name}\\s*=\\s*(.*?)\\s*$`, "m")
  );

  if (!match) return undefined;

  let value = match[1].trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value;
}

const url =
  readEnv("SUPABASE_URL") ||
  readEnv("VITE_SUPABASE_URL");

const key =
  readEnv("SUPABASE_ANON_KEY") ||
  readEnv("VITE_SUPABASE_ANON_KEY") ||
  readEnv("SUPABASE_PUBLISHABLE_KEY") ||
  readEnv("VITE_SUPABASE_PUBLISHABLE_KEY");

console.log("\nURL found:", !!url);
console.log("API key found:", !!key);

if (!url) {
  console.log("\n❌ No Supabase URL variable found.");
  console.log("Available variable names:");

  console.log(
    envText
      .split(/\r?\n/)
      .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
      .map((line) => line.split("=")[0].trim())
  );

  process.exit(1);
}

if (!key) {
  console.log("\n❌ No API key found.");
  process.exit(1);
}

console.log("Project URL:", url);
console.log("Project ID:", url.match(/https:\/\/([^.]+)/)?.[1] || "Unknown");

try {
  console.log("\nChecking Supabase REST API...");

  const response = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });

  console.log("REST status:", response.status);

  console.log("\nChecking profiles table...");

  const profiles = await fetch(
    `${url}/rest/v1/profiles?select=user_id&limit=1`,
    {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    }
  );

  const body = await profiles.text();

  console.log("Profiles status:", profiles.status);
  console.log("Profiles response:", body);

  if (profiles.ok) {
    console.log("\n✅ Supabase connection and profiles query succeeded.");
  } else {
    console.log("\n❌ Profiles query failed.");
  }
} catch (error) {
  console.error("\n❌ Connection error:", error.message);
}