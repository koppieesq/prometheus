# ADR 0001: CLI implementation (bash now, Robo later?)

Status: accepted for v0.x, revisit before v1.0

## Context

`prm` is currently a ~250-line bash script. The alternative is [Robo](https://robo.li) (PHP task runner,
Symfony Console based, the same family as Drush and Terminus, so Drupal people can read and extend it).

## Trade-offs

Bash (today):
- Zero host dependencies beyond docker + openssl. A fresh VPS can run it right after the bootstrap script.
- Works over SSH with nothing installed; trivially auditable.
- Weak at: structured config parsing, unit tests, error handling as it grows, cross-platform.

Robo:
- Real language: typed config (YAML/dotenv), tests (PHPUnit), reusable tasks, nicer UX (tables, progress, prompts).
- Natural fit for Drupal-flavoured contributors and for a future Terminus-style command set
  (`prm backup:create`, `prm env:clone`, `prm multidev`).
- Cost: needs PHP + Composer. Installing PHP on the host contradicts the "only docker" story.

## Decision

1. Keep the bash CLI through v0.x, until CI has proven the stack on real Docker. Rewriting an untested
   tool in a language that could not be run in the authoring environment would stack risk on risk.
2. When rewriting, do it as Robo **inside a container**, not on the host:
   - `bin/prm` stays a ~15-line bash shim that runs `docker run --rm ... prm/cli` with the sites dir,
     the project dir and the docker socket mounted, so the host still needs only Docker.
   - Mounting the docker socket is root-equivalent. That is acceptable for an operator CLI run by the host admin,
     but it must never be mounted into any site container; document this.
3. Keep the command surface identical so the rewrite is a drop-in. The CI smoke test is the contract:
   it runs the same commands against both implementations until bash can be retired.

## Consequences

The rewrite is a contained v0.2 milestone, not a prerequisite for shipping. Contributors can start on
`cli/` (Robo) in parallel; bash remains the reference until parity is demonstrated.
