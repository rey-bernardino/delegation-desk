// src/core/variants.js
//
// Block names are templated per variant in config ({variant}). Both the
// selection controller and the validation service need to resolve them, so the
// resolving lives here rather than being duplicated.

export function resolveName(name, variant) {
  return name.replace("{variant}", variant);
}

export function blockNamesFor(config, variant) {
  return (config.selection?.enterBlocks || []).map((name) =>
    resolveName(name, variant)
  );
}

export function formBlockNamesFor(config, variant) {
  return (config.selection?.enterFormBlocks || []).map((name) =>
    resolveName(name, variant)
  );
}
