import assert from "node:assert/strict";
import test from "node:test";

import { SfileProvider } from "../src/providers/sfile/sfile.provider.js";
import { Deadline } from "../src/core/deadline.js";
import { assertPublicEndpoint } from "../src/security/ssrf.js";
import { ResolverError } from "../src/core/errors.js";
import { parseAndValidateUrl } from "../src/security/urlValidator.js";

test("Sfile provider detects supported hostnames only", () => {
  const provider = new SfileProvider();

  assert.equal(provider.detect(new URL("https://sfile.mobi/file.apk")), true);
  assert.equal(provider.detect(new URL("https://www.sfile.mobi/file.apk")), true);
  assert.equal(provider.detect(new URL("https://example.com/file.apk")), false);
  assert.equal(provider.detect(new URL("https://sfile.mobi.evil.example/file.apk")), false);
});

test("URL validator rejects embedded credentials and non-HTTP schemes", () => {
  assert.throws(
    () => parseAndValidateUrl("https://user:pass@example.com/"),
    (error: unknown) =>
      error instanceof ResolverError && error.code === "INVALID_URL"
  );

  assert.throws(
    () => parseAndValidateUrl("javascript:alert(1)"),
    (error: unknown) =>
      error instanceof ResolverError && error.code === "INVALID_URL"
  );
});

test("SSRF guard rejects private and reserved literal IPs", async () => {
  for (const candidate of [
    "http://127.0.0.1/",
    "http://10.0.0.1/",
    "http://169.254.169.254/",
    "http://192.168.1.1/",
    "http://[::1]/",
    "http://[fc00::1]/"
  ]) {
    await assert.rejects(
      async () => {
        await assertPublicEndpoint(
          parseAndValidateUrl(candidate),
          new Deadline(1_000)
        );
      },
      (error: unknown) =>
        error instanceof ResolverError && error.code === "SECURITY_BLOCKED"
    );
  }
});
