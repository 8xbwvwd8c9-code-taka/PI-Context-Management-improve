# Research Provenance

This file tracks external projects and internal sources used to inform CMV3.

No external source code is copied by default. Architectural ideas may be
reimplemented behind CMV3-owned contracts after license and provenance review.

The full R01 assimilation matrix, with revision pins, files inspected, ideas
reused, and the license-classification rule, lives in
[`docs/research/CMV3_PORTABLE_ASSIMILATION.md`](research/CMV3_PORTABLE_ASSIMILATION.md).
This file is the short, current state pointer; the long table lives there.

## Internal sources

- ST_BOT CMV3-00 baseline (historical)
- ST_BOT CMV3-00A telemetry gate (historical)
- ST_BOT CMV3-01 profiles / budgeter pilot (host-project implementation; contracts reimplemented in portable core, code not copied)
- ST_BOT supervisor durable-state surfaces (host-project lessons)
- Pi auto-compact telemetry observations (read-only; `HIGH_WATER=110_000` / `LOW_WATER=70_000` unchanged)

## External repositories to review

| Repository | Focus | License status | Code reuse |
|---|---|---|---|
| ttttmr/pi-context | combined Extension + Skill packaging, checkpoint/timeline/context management | `PACKAGE_METADATA_ONLY=YES` (MIT in package.json), `LICENSE_FILE_PRESENT=NO` | `CODE_REUSED=NO` (license-file absence blocks direct reuse; architecture reused as lessons only) |
| underactive/pi-mimo-cme | session/project/global/history memory layers | `LICENSE_VERIFIED=NO`, `PACKAGE_METADATA_ONLY=NO`, `LICENSE_FILE_PRESENT=NO` (provenance blocker) | `CODE_REUSED=NO` |
| MohamedElashri/pi-mcb | deterministic compaction and durable recall | `PACKAGE_METADATA_ONLY=YES` (MIT in package.json), `LICENSE_FILE_PRESENT=NO`; renamed derivative of `pi-blackhole` | `CODE_REUSED=NO` (license-file absence + unverified dependency-chain license trail) |
| TheArchitectit/pi-mega-compact | 32K local-first context / recall concepts | `PACKAGE_METADATA_ONLY=YES` (BSD-3-Clause in package.json), `LICENSE_FILE_PRESENT=NO`; LTS with Rust successor | `CODE_REUSED=NO` (license-file absence + LTS succession) |
| lukeramsden/pi-context-cap | explicit context budgets and output reserve | `PACKAGE_METADATA_ONLY=YES` (MIT in package.json), `LICENSE_FILE_PRESENT=NO` | `CODE_REUSED=NO` (license-file absence) |

### Provenance classification rule

For every future direct code reuse, record:

```text
LICENSE_VERIFIED         — source-license provenance chain inspected end-to-end
PACKAGE_METADATA_ONLY    — license declared in package.json but no top-level LICENSE file
LICENSE_FILE_PRESENT     — top-level LICENSE / LICENSE.md / LICENSE.txt exists and matches package.json
CODE_REUSE_ALLOWED       — license is permissive AND provenance verified AND CMV3 needs reuse
CODE_REUSED              — actual code (not just architecture) was incorporated
```

`LICENSE_FILE_PRESENT=NO` is sufficient to block direct code reuse
even when `PACKAGE_METADATA_ONLY=YES` declares a permissive license;
the field must be verified against an actual `LICENSE` file at the
revision being reused before code is copied. Package metadata alone
is NOT equivalent to verified source-license provenance when direct
code reuse is proposed.

Current default: `CODE_REUSED=NO` for every external repo. Architectural
lessons may be reimplemented behind CMV3-owned contracts.
