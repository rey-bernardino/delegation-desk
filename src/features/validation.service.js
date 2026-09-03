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

  // Fields in an optional block are never required.
  function isOptionalField(field) {
    const holder = field.closest("[form-block]");

    return (rules.optionalFormBlocks || []).includes(
      holder?.getAttribute("form-block")
    );
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

    isTouched(field) {
      return field.hasAttribute(TOUCHED_ATTR);
    },

    markTouched(field) {
      field.setAttribute(TOUCHED_ATTR, "");
    },

    isOptionalField,

    // Value check only — no styling, no scope check.
    isFieldValid(field) {
      if (isOptionalField(field)) {
        return true;
      }

      const type = String(field.type || "").toLowerCase();

      // A checkbox always has a value attribute, so reading .value would make
      // an unticked box look filled in.
      if (type === "checkbox" || type === "radio") {
        return field.checked === true;
      }

      const value = String(field.value || "").trim();

      if (!value) {
        return false;
      }

      if (isEmailField(field)) {
        return validateEmail(value) && !hasInvalidEmailDots(value);
      }

      return true;
    },

    // Styling is applied only once a field has been touched, so an untouched
    // form is never shown as a wall of errors.
    showFieldState(field) {
      const isValid = this.isFieldValid(field);

      if (!this.isTouched(field)) {
        return isValid;
      }

      if (isValid) {
        markValid(field);
      } else {
        markInvalid(field);
      }

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
      const fields = this.getScopedFields();
      const invalid = fields.filter((field) => !this.isFieldValid(field));

      return {
        isValid: fields.length > 0 && invalid.length === 0,
        total: fields.length,
        invalid,
      };
    },

    // Full pass. reveal: true marks every field touched first, so a submit
    // attempt surfaces every outstanding error at once.
    validateAll(options = {}) {
      const fields = this.getScopedFields();

      if (options.reveal) {
        fields.forEach((field) => this.markTouched(field));
      }

      const invalid = fields.filter((field) => !this.showFieldState(field));

      return {
        isValid: invalid.length === 0,
        total: fields.length,
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
