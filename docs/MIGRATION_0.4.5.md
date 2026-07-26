# Migrating to OrbitPM Process Studio Lite 0.4.5

0.4.5 makes the browser-based Lite application the only active OrbitPM
product. The older Electron/Desktop, Docker, bridge, and server variants remain
recoverable as unsupported historical source; they are not bundled with or
launched by 0.4.5.

## Before moving

1. Export or copy every `.bpmn` file from the existing product.
2. Retain an independent backup of the old workspace or process library.
3. If using a 0.4.5 directory or OPFS candidate, export its workspace backup
   before switching browsers, profiles, devices, or storage modes.
4. Record provider configuration separately. Do not copy API keys into BPMN,
   mapping presets, or workspace files.
5. Test important diagrams in the 0.4.5 candidate before retiring the previous
   working environment.

There is no automatic migration from a Desktop application database or a
server repository. Portable BPMN XML is the interchange format. A bounded
process-library ZIP can import multiple BPMN files, and ARIS AML/APC conversion
is available as an experimental best-effort path.

## Opening v0.4.4 BPMN

The BPMN 2.0 content remains standard XML. 0.4.5 continues to read the OrbitPM
namespace:

```text
http://orbitpm.ae/schema/bpmn/1.0
```

Existing `orbitpm:nameEn`, `orbitpm:nameAr`, and `orbitpm:activeLang`
attributes continue to work. Existing unsuffixed organizational metadata also
remains readable.

On an edited bilingual value, 0.4.5 retains the unsuffixed field as the active
display projection and writes paired English/Arabic values. This preserves
older readers while allowing script-aware auditing.

If a target value is nonblank but contains the wrong script—for example
`nameAr="Approve request"`—0.4.5 treats it as invalid and opens translation
review. Import itself does not contact a translation provider.

## OrbitPM 0.4.5 extension contract

The extension prefix is `orbitpm`. Attributes are plain strings on BPMN
`BaseElement` objects.

### Diagram language

| Attribute                       | Meaning                                                     |
| ------------------------------- | ----------------------------------------------------------- |
| `nameEn`, `nameAr`              | Stored English and Arabic labels                            |
| `activeLang`                    | Process-level active projection, `en` or `ar`               |
| BPMN `name` / annotation `text` | Unsuffixed visible projection used by standard BPMN readers |

### Paired translatable metadata

Each family keeps the unsuffixed active projection and may add `En` and `Ar`
counterparts:

- `owner`
- `department`
- `ownerRole`
- `channelDetail`
- `ccTo`
- `triggerService`
- `triggerDetail`
- `triggers`
- `inputs`
- `outputs`
- `system`
- `respList`
- `ccList`
- `decisionBasis`
- `notes`

Code-like attributes such as `ownerType`, `channel`, and `kind` remain
unsuffixed. IDs, filenames, links, API/model names, codes, email addresses, and
URLs are not translation targets.

Multi-value organizational fields retain their existing newline-separated
serialization. Consumers should preserve unknown `orbitpm:*` attributes.

### Other vendor extensions

0.4.5 inventories opaque extension elements and attributes before accepting
normalized XML. Dropped, changed, or rerouted unknown content is a blocking
preservation finding. Byte-identical serialization of all XML formatting is
not promised, but unknown semantic payload is not intentionally discarded.

Keep a source backup when editing a file with vendor extensions that the
OrbitPM moddle descriptor does not understand.

## Workspace files

The active portable workspace feature uses:

- `.orbitpm/history/` for bounded revisions in directory and OPFS workspaces.

The release plan reserves these public paths:

- `.orbitpm/i18n/glossary.json`
- `.orbitpm/i18n/translation-memory.json`
- `.orbitpm/manifest.json`

The current App does not yet provide persistence/editing UI for those glossary,
translation-memory, or workspace-manifest files. If they already exist, the
workspace adapter treats them as public files and includes them in a complete
backup; do not rely on the App to update their schema in this candidate.

Browser-private provider credentials, provider usage, interface preferences,
mapping drafts, and remembered directory handles are never silently copied
into a workspace backup.

## Provider settings from 0.4.4

Opening Settings looks for supported 0.4.4 plaintext provider keys. A found key
is moved into page memory and the plaintext browser-storage record is removed.
It is not made persistent again unless the user explicitly selects encrypted
persistence and supplies a passphrase.

The old Custom provider is removed. Direct OpenAI, Azure, DeepSeek, Moonshot,
and GLM vendor endpoints are not migrated. Configure OpenRouter, Anthropic, or
Gemini and explicitly select a provider/model.

## Historical recovery

- Full-product branch:
  [`archive/full-product-v0.4.4`](https://github.com/ahmedak320/bpmn-studio/tree/archive/full-product-v0.4.4)
- Annotated archive tag: `archive-full-product-v0.4.4`
- Published baseline tag: `v0.4.4`

Those references are unsupported historical records and must not be presented
as alternate 0.4.5 products. Bundle checksums and recovery verification are in
[archive/0.4.4.md](archive/0.4.4.md).
