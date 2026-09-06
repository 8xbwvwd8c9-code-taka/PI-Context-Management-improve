# Research Provenance

This file tracks external projects and internal sources used to inform CMV3.

No external source code is copied by default. Architectural ideas may be reimplemented behind CMV3-owned contracts after license and provenance review.

## Internal sources

- ST_BOT CMV3-00 baseline
- ST_BOT CMV3-00A telemetry gate
- ST_BOT CMV3-01 profiles / budgeter experiment
- ST_BOT supervisor durable-state surfaces
- Pi auto-compact telemetry observations

## External repositories to review

| Repository | Focus | Code reuse |
|---|---|---|
| ttttmr/pi-context | combined Extension + Skill packaging, checkpoint/timeline/context management | NO by default |
| underactive/pi-mimo-cme | session/project/global/history memory layers | NO by default |
| MohamedElashri/pi-mcb | deterministic compaction and durable recall | NO by default |
| TheArchitectit/pi-mega-compact | 32K local-first context / recall concepts | NO by default |
| lukeramsden/pi-context-cap | explicit context budgets and output reserve | NO by default |

For every future direct code reuse, record exact repository revision, license, source file, and copied/modified scope before merge.
