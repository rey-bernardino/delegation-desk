// src/features/payload.service.js
//
// Builds what gets sent, and nothing else — no posting, no side effects. Two
// shapes, because the two destinations want different things:
//
//   quiz     — the full answer set, destined for a single field
//   hubspot  — contact properties only
//
// Values are read off the DOM at build time, so whatever is on screen is what
// is captured.

import { formBlockNamesFor } from "../core/variants.js";
import { getCookie } from "../utils/cookies.js";

export function createPayloadService({ config, dom, state }) {
  const settings = config.payload || {};
  const labelSelector = settings.labelSelector || ".d-field-label";
  const wrapperSelector =
    config.validation?.fieldWrapper || ".d-field-container";
  const infoBlockName = settings.infoFormBlock || "info";
  const categoryKey = settings.categoryKey || "category";
  const fieldSelector = config.fieldSelector || ".d-field";

  function fieldsIn(blockName) {
    const block = dom.getFormBlock(blockName);

    return block ? Array.from(block.querySelectorAll(fieldSelector)) : [];
  }

  // Everything named in the info block, including the hidden inputs Webflow
  // ships pre-filled (utm_*, hdyhau_*, phone) and the ones this quiz writes.
  // These are contact/attribution data HubSpot expects, so the API payload
  // carries them even though the user never sees them.
  function allNamedFieldsIn(blockName) {
    const block = dom.getFormBlock(blockName);

    if (!block) {
      return [];
    }

    return Array.from(
      block.querySelectorAll("input[name], select[name], textarea[name]")
    );
  }

  // Category form blocks are the scoped ones minus info. Blocks with no fields
  // (submit) fall out on their own.
  function categoryBlockNames(variant) {
    return formBlockNamesFor(config, variant).filter(
      (name) => name !== infoBlockName
    );
  }

  return {
    categoryLabelFor(variant = state.selectedVariant) {
      if (!variant) {
        return null;
      }

      return config.variantLabels?.[variant] || variant;
    },

    labelOf(field) {
      const label = field
        .closest(wrapperSelector)
        ?.querySelector(labelSelector);

      return (label?.textContent || "").trim() || field.name || "";
    },

    valueOf(field) {
      const type = String(field.type || "").toLowerCase();

      if (type === "checkbox" || type === "radio") {
        return field.checked ? field.value || "true" : "";
      }

      return String(field.value ?? "").trim();
    },

    // Visible contact fields only — what a human filled in.
    getInfoFields() {
      return fieldsIn(infoBlockName);
    },

    // Everything HubSpot should receive: the visible contact fields plus the
    // hidden attribution inputs sitting alongside them.
    getHubspotFields() {
      return allNamedFieldsIn(infoBlockName);
    },

    getCategoryFields(variant = state.selectedVariant) {
      if (!variant) {
        return [];
      }

      return categoryBlockNames(variant).flatMap(fieldsIn);
    },

    // Category, the info fields as separate top-level keys, and the category's
    // own answers with their labels.
    buildQuizPayload(variant = state.selectedVariant) {
      if (!variant) {
        return null;
      }

      const payload = {
        [categoryKey]: variant,
        categoryLabel: this.categoryLabelFor(variant),
      };

      this.getInfoFields().forEach((field) => {
        payload[field.name] = this.valueOf(field);
      });

      payload.answers = this.getCategoryFields(variant).map((field) => ({
        name: field.name,
        label: this.labelOf(field),
        value: this.valueOf(field),
      }));

      return payload;
    },

    // Flat name -> value of every info-block field. The chosen category rides
    // along in config.hiddenFields.choice rather than as a synthetic key —
    // HubSpot rejects properties it doesn't know, and that hidden input is the
    // property it actually has.
    buildHubspotPayload(variant = state.selectedVariant) {
      if (!variant) {
        return null;
      }

      const payload = {};

      this.getHubspotFields().forEach((field) => {
        payload[field.name] = this.valueOf(field);
      });

      // Belt and braces: selection fills this on click, but a payload built
      // straight from the console should still be correct.
      const choiceField = config.hiddenFields?.choice;

      if (choiceField) {
        payload[choiceField] = this.categoryLabelFor(variant);
      }

      return payload;
    },

    // HubSpot Forms v3 submission body, same shape as athena-form's
    // hubspot.service.js buildSubmissionPayload().
    buildHubspotApiPayload(variant = state.selectedVariant) {
      const flat = this.buildHubspotPayload(variant);

      if (!flat) {
        return null;
      }

      const context = {
        pageUri: window.location.href,
        pageName: document.title,
      };

      const hutk = getCookie("hubspotutk");

      if (hutk && String(hutk).trim()) {
        context.hutk = String(hutk).trim();
      }

      return {
        submittedAt: Date.now(),
        fields: Object.entries(flat).map(([name, value]) => ({ name, value })),
        context,
      };
    },

    buildAll(variant = state.selectedVariant) {
      const quiz = this.buildQuizPayload(variant);

      return {
        category: variant || null,
        categoryLabel: this.categoryLabelFor(variant),

        quiz,

        // The quiz payload is destined for a single field, so hand over the
        // serialised form too rather than making every caller stringify it.
        quizJson: quiz ? JSON.stringify(quiz) : null,

        hubspot: this.buildHubspotPayload(variant),
        hubspotApi: this.buildHubspotApiPayload(variant),
      };
    },
  };
}
