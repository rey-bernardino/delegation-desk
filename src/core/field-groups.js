// src/core/field-groups.js
//
// A "pick any of N" question is several checkbox inputs that answer one
// question. Both validation and the payload need to treat them as one field —
// validation because requiring each box individually would mean the user has
// to tick all of them, and the payload because the summary's `fields` map is
// keyed by field name, so N boxes sharing a name would overwrite each other
// down to whichever came last.
//
// Grouping lives here rather than in either consumer, because the two must
// agree: a group the payload merges but validation still checks per box would
// gate the submit button on an answer that was already given.
//
// Radios are grouped by the same rule, and get the same fix for free — only
// one of them can ever be checked, so validating each in turn made a radio
// group impossible to satisfy.

const CHECKED_TYPES = ["checkbox", "radio"];

// Warned-about wrappers, so a mis-authored group says so once rather than on
// every keystroke.
const warned = new WeakSet();

export function typeOf(field) {
  return String(field.type || "").toLowerCase();
}

export function isCheckedType(field) {
  return CHECKED_TYPES.includes(typeOf(field));
}

// The group a single field belongs to, resolved against its own form block —
// two categories may legitimately reuse a field name, and only one of them is
// on screen.
export function groupOf(field, { fieldSelector = ".d-field" } = {}) {
  const name = field.getAttribute("name");

  if (!isCheckedType(field) || !name) {
    return { name: name || "", type: typeOf(field), fields: [field] };
  }

  const scope = field.closest("[form-block]") || document;

  const fields = Array.from(
    scope.querySelectorAll(
      `${fieldSelector}[name="${CSS.escape(name)}"]`
    )
  ).filter((candidate) => typeOf(candidate) === typeOf(field));

  return {
    name,
    type: typeOf(field),
    fields: fields.length ? fields : [field],
  };
}

// Collapses a field list into groups, preserving document order: a group takes
// the position of its first member, so the cascade of errors and the column
// order in the sheet both still read top-to-bottom.
export function groupFields(fields, options = {}) {
  const groups = [];
  const seen = new Set();

  fields.forEach((field) => {
    if (seen.has(field)) {
      return;
    }

    const group = groupOf(field, options);

    group.fields.forEach((member) => seen.add(member));
    groups.push(group);
  });

  warnOnSplitNames(groups, options);

  return groups;
}

export function isMultiGroup(group) {
  return group.fields.length > 1;
}

// Webflow names checkboxes uniquely by default — Checkbox, Checkbox-2 — so a
// group authored without renaming them looks like N separate one-box questions
// and every one of them becomes required. That failure is invisible: the form
// simply refuses to enable submit. Catch it by looking for several differently
// named checkboxes sharing one field wrapper, which is what a group looks like
// when the rename was forgotten.
function warnOnSplitNames(groups, { wrapperSelector = ".d-field-container" }) {
  const byWrapper = new Map();

  groups.forEach((group) => {
    const field = group.fields[0];

    if (!isCheckedType(field) || isMultiGroup(group)) {
      return;
    }

    const wrapper = field.closest(wrapperSelector);

    if (!wrapper) {
      return;
    }

    byWrapper.set(wrapper, (byWrapper.get(wrapper) || []).concat(group.name));
  });

  byWrapper.forEach((names, wrapper) => {
    if (names.length < 2 || warned.has(wrapper)) {
      return;
    }

    warned.add(wrapper);

    console.warn(
      "Delegation Desk: several checkboxes share one field wrapper but have " +
        "different names, so each one is treated as its own required " +
        "question. Give every option in a pick-any group the SAME name.",
      { names, wrapper }
    );
  });
}
