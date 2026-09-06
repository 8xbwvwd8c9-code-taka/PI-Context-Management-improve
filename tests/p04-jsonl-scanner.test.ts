import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdirSync, readSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
	createFsJsonlParentScanner,
	DEFAULT_MAX_JSONL_HEADER_BYTES,
} from "../src/pi/jsonl-parent-scanner.js";

function freshRoot(tag: string): string {
	const root = join(tmpdir(), `picm-p04-${tag}-${process.pid}-${randomBytes(4).toString("hex")}`);
	mkdirSync(root, { recursive: true });
	return root;
}

function writeSession(path: string, parentSession: string, body = ""): void {
	writeFileSync(path, `${JSON.stringify({ parentSession })}\n${body}`, "utf8");
}

describe("P04 filesystem JSONL scanner", () => {
	it("T-P04-R2: an existing sessions root readdir failure is incomplete", () => {
		const root = freshRoot("readdir");
		const scanner = createFsJsonlParentScanner(root, {
			readdir: () => { throw new Error("EACCES synthetic"); },
		});
		const result = scanner.findChildren("parent-r2");
		assert.equal(result.kind, "incomplete");
		if (result.kind === "incomplete") assert.match(result.detail, /EACCES/);
	});

	it("T-P04-R3: discovers children under multiple project directories", () => {
		const root = freshRoot("nested");
		mkdirSync(join(root, "project-a"));
		mkdirSync(join(root, "project-b"));
		writeSession(join(root, "project-a", "child-a.jsonl"), "parent-r3");
		writeSession(join(root, "project-b", "child-b.jsonl"), "other-parent");
		assert.deepEqual(createFsJsonlParentScanner(root).findChildren("parent-r3"), {
			kind: "complete",
			children: ["child-a"],
		});
	});

	it("T-P04-R4: two nested matching children remain distinct and deterministic", () => {
		const root = freshRoot("ambiguous");
		mkdirSync(join(root, "project-b"));
		mkdirSync(join(root, "project-a"));
		writeSession(join(root, "project-b", "child-b.jsonl"), "parent-r4");
		writeSession(join(root, "project-a", "child-a.jsonl"), "parent-r4");
		assert.deepEqual(createFsJsonlParentScanner(root).findChildren("parent-r4"), {
			kind: "complete",
			children: ["child-a", "child-b"],
		});
	});

	it("T-P04-R5: reads only the bounded header from a large transcript", () => {
		const root = freshRoot("bounded");
		mkdirSync(join(root, "project-a"));
		writeSession(join(root, "project-a", "child.jsonl"), "parent-r5", "x".repeat(2_000_000));
		let bytesRead = 0;
		const scanner = createFsJsonlParentScanner(root, {
			read: (fd, buffer, offset, length, position) => {
				const count = readSync(fd, buffer, offset, length, position);
				bytesRead += count;
				return count;
			},
		});
		assert.equal(scanner.findChildren("parent-r5").kind, "complete");
		assert.ok(bytesRead <= DEFAULT_MAX_JSONL_HEADER_BYTES + 1);
	});

	it("T-P04-R6: an oversized first line makes the scan incomplete", () => {
		const root = freshRoot("oversized");
		mkdirSync(join(root, "project-a"));
		writeFileSync(
			join(root, "project-a", "child.jsonl"),
			`${JSON.stringify({ parentSession: "x".repeat(DEFAULT_MAX_JSONL_HEADER_BYTES) })}\n`,
		);
		const result = createFsJsonlParentScanner(root).findChildren("parent-r6");
		assert.equal(result.kind, "incomplete");
	});

	it("T-P04-R6: an unreadable candidate header makes the scan incomplete", () => {
		const root = freshRoot("unreadable");
		writeSession(join(root, "child.jsonl"), "parent-r6");
		const result = createFsJsonlParentScanner(root, {
			read: () => { throw new Error("synthetic read failure"); },
		}).findChildren("parent-r6");
		assert.equal(result.kind, "incomplete");
		if (result.kind === "incomplete") assert.match(result.detail, /synthetic read failure/);
	});

	it("does not follow symlinks or treat hidden evidence as authoritative zero", () => {
		const root = freshRoot("symlink");
		const outside = freshRoot("symlink-target");
		writeSession(join(outside, "child.jsonl"), "parent-link");
		symlinkSync(outside, join(root, "linked-project"));
		assert.equal(createFsJsonlParentScanner(root).findChildren("parent-link").kind, "incomplete");
	});

	it("complete nested scan with no match is authoritative zero", () => {
		const root = freshRoot("zero");
		mkdirSync(join(root, "project-a"));
		writeSession(join(root, "project-a", "child.jsonl"), "another-parent");
		assert.deepEqual(createFsJsonlParentScanner(root).findChildren("parent-zero"), {
			kind: "complete",
			children: [],
		});
	});
});
