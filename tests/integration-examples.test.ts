import assert from "node:assert/strict";
import test from "node:test";
import { GET, POST, runtime } from "../examples/next-route-handler.js";

test("Next.js route example exports Fetch-native GET and POST handlers", () => {
  assert.equal(typeof GET, "function");
  assert.equal(typeof POST, "function");
  assert.equal(runtime, "nodejs");
});
