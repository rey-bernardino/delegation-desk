// src/features/validation.service.js
//
// Every field in the current category is required. Tactics follow athena-form's
// validation.service.js: a wrapper element carries an `invalid` class, and the
// styling (red border, revealed .errorMessage) is Webflow's.
//
// Scope is the whole point. Only the selected category's form blocks are
// validated — the other four sit in the DOM with empty fields and must never
// count against the user.

import { formBlockNamesFor } from "../core/variants.js";
import { groupFields, groupOf, isCheckedType } from "../core/field-groups.js";

// Marks a field the user has actually interacted with. Equivalent to
// athena-form's solo="" convention, inverted: there, untouched fields carry the
// attribute; here, touched ones do. Untouched fields validate but stay unstyled,
// so the form isn't red before it has been filled in.
const TOUCHED_ATTR = "data-dd-touched";

export function createValidationService({ config, dom, state, lenis }) {
  const rules = config.validation || {};
  const wrapperSelector = rules.fieldWrapper || ".d-field-container";
  const invalidClass = rules.invalidClass || "invalid";
  const fieldSelector = config.fieldSelector || ".d-field";
  const optionalAttribute = rules.optionalAttribute || "field-optional";

  // Webflow's custom-attribute panel wants a name AND a value, so a bare
  // attribute isn't always authorable — treat a present-but-empty one as true.
  // The negations matter more: field-optional="false" reads as "required" to
  // anyone authoring it, and silently making it optional would be a trap.
  const NEGATIONS = ["false", "0", "no", "off"];

  function validateEmail(email) {
    const regex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    return regex.test(String(email).toLowerCase());
  }

  function hasInvalidEmailDots(email) {
    const value = String(email || "").trim();

    if (value.includes("..")) return true;

    const [localPart, domainPart] = value.split("@");

    if (!localPart || !domainPart) return true;

    if (localPart.startsWith(".") || localPart.endsWith(".")) return true;
    if (domainPart.startsWith(".") || domainPart.endsWith(".")) return true;

    return domainPart
      .split(".")
      .some((part) => !part || part.startsWith("-") || part.endsWith("-"));
  }

  function wrapperOf(field) {
    return field.closest(wrapperSelector) || field.parentElement;
  }

  function markInvalid(field) {
    wrapperOf(field)?.classList.add(invalidClass);
  }

  function markValid(field) {
    wrapperOf(field)?.classList.remove(invalidClass);
  }

  // Fields in an optional block are never required, and so is anything
  // carrying the optional attribute at or above itself.
  function isOptionalField(field) {
    const holder = field.closest("[form-block]");

    if (
      (rules.optionalFormBlocks || []).includes(
        holder?.getAttribute("form-block")
      )
    ) {
      return true;
    }

    // closest, so the flag can be authored on the input, on the wrapper (which
    // is how a whole pick-any group is exempted in one edit), or on a section.
    // Nearest wins, which lets one required field sit inside an optional
    // section.
    const flagged = field.closest(`[${optionalAttribute}]`);

    if (!flagged) {
      return false;
    }

    const raw = (flagged.getAttribute(optionalAttribute) || "")
      .trim()
      .toLowerCase();

    return !NEGATIONS.includes(raw);
  }

  function groupFor(field) {
    return groupOf(field, { fieldSelector });
  }

  function isEmailField(field) {
    return (
      String(field.type || "").toLowerCase() === "email" ||
      String(field.name || "").toLowerCase() === "email"
    );
  }

  return {
    TOUCHED_ATTR,

    // The fields validation is allowed to touch: those inside the selected
    // category's form blocks, and only while the quiz is on screen.
    getScopedFields() {
      const variant = state.selectedVariant;

      if (!variant || !state.showingQuiz) {
        return [];
      }

      return formBlockNamesFor(config, variant)
        .map((name) => dom.getFormBlock(name))
        .filter(Boolean)
        .flatMap((block) => Array.from(block.querySelectorAll(fieldSelector)));
    },

    // The same scope, collapsed so each question counts once.
    getScopedGroups() {
      return groupFields(this.getScopedFields(), {
        fieldSelector,
        wrapperSelector,
      });
    },

    isTouched(field) {
      return field.hasAttribute(TOUCHED_ATTR);
    },

    markTouched(field) {
      field.setAttribute(TOUCHED_ATTR, "");
    },

    // Touched-ness is a property of the QUESTION, not the input. The user
    // leaves exactly one box of a pick-any group, so asking whether the box
    // they just ticked has been touched says nothing about whether they have
    // engaged with the question — and answering it by ticking a second option
    // would leave the first one's error frozen on screen.
    isTouchedGroup(field) {
      return groupFor(field).fields.some((member) => this.isTouched(member));
    },

    isOptionalField,

    groupFor,

    // Value check only — no styling, no scope check. The unit is the GROUP,
    // not the input: a "pick any of N" question is answered as soon as one of
    // its boxes is ticked.
    isGroupValid(group) {
      const field = group.fields[0];
      const optional = isOptionalField(field);

      // A checkbox always has a value attribute, so reading .value would make
      // an unticked box look filled in.
      //
      // `some`, not `every`: checking each box in turn would require the user
      // to tick all of them, and would make a radio group impossible to
      // satisfy at all, since only one of those can ever be checked.
      if (isCheckedType(field)) {
        return optional || group.fields.some((member) => member.checked === true);
      }

      const value = String(field.value || "").trim();

      // Optional means BLANK is acceptable — not that anything is. A filled-in
      // optional email still has to be a real address, or the CRM quietly
      // collects addresses that bounce.
      if (!value) {
        return optional;
      }

      if (isEmailField(field)) {
        return validateEmail(value) && !hasInvalidEmailDots(value);
      }

      return true;
    },

    isFieldValid(field) {
      return this.isGroupValid(groupFor(field));
    },

    // Styling is applied only once a field has been touched, so an untouched
    // form is never shown as a wall of errors.
    showFieldState(field) {
      const group = groupFor(field);
      const isValid = this.isGroupValid(group);

      // ANY member being touched counts. The user only ever leaves one box of
      // a group, so requiring all of them touched would keep the error hidden
      // no matter how long they stared at it.
      if (!this.isTouchedGroup(field)) {
        return isValid;
      }

      // Options normally share one .d-field-container, in which case this is
      // the same element N times over; when they are wrapped individually it
      // keeps the whole group styled consistently.
      group.fields.forEach((member) => {
        if (isValid) {
          markValid(member);
        } else {
          markInvalid(member);
        }
      });

      // .errorMessage flips between display none and block, so the page height
      // moves every time a field's state changes.
      lenis?.scheduleRefresh();

      return isValid;
    },

    validateField(field) {
      if (!this.getScopedFields().includes(field)) {
        return true;
      }

      return this.showFieldState(field);
    },

    // Reads values only — no styling, no touched flags. This drives the
    // submit button, which has to reflect validity long before the user has
    // visited every field.
    checkAll() {
      const groups = this.getScopedGroups();
      const invalid = groups.filter((group) => !this.isGroupValid(group));

      return {
        isValid: groups.length > 0 && invalid.length === 0,
        total: groups.length,
        invalid: invalid.map((group) => group.fields[0]),
      };
    },

    // Full pass. reveal: true marks every field touched first, so a submit
    // attempt surfaces every outstanding error at once.
    validateAll(options = {}) {
      const groups = this.getScopedGroups();

      if (options.reveal) {
        groups.forEach((group) =>
          group.fields.forEach((field) => this.markTouched(field))
        );
      }

      const invalid = groups
        .filter((group) => !this.showFieldState(group.fields[0]))
        .map((group) => group.fields[0]);

      return {
        isValid: invalid.length === 0,
        total: groups.length,
        invalid,
        firstInvalid: invalid[0] || null,
      };
    },

    // Used after a category switch wipes values: stale red borders and a stale
    // touched flag would otherwise carry over to the new category's fields.
    resetFields(fields) {
      (fields || []).forEach((field) => {
        field.removeAttribute(TOUCHED_ATTR);
        markValid(field);
      });
    },

    validateEmail,
  };
}
