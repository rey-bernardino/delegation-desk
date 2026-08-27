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

  // Category form blocks are the scoped ones minus info. Blocks with no fields
  // (submit) fall out on their own.
  function categoryBlockNames(variant) {
    return formBlockNamesFor(config, variant).filter(
      (name) => name !== infoBlockName
    );
  }

  return {
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

    getInfoFields() {
      return fieldsIn(infoBlockName);
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

      const payload = { [categoryKey]: variant };

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

    // Info block only, plus which category was picked. firstname / lastname /
    // email / company are already HubSpot's own property names.
    buildHubspotPayload(variant = state.selectedVariant) {
      if (!variant) {
        return null;
      }

      const payload = {};

      this.getInfoFields().forEach((field) => {
        payload[field.name] = this.valueOf(field);
      });

      payload[categoryKey] = variant;

      return payload;
    },

    buildAll(variant = state.selectedVariant) {
      const quiz = this.buildQuizPayload(variant);

      return {
        quiz,
        hubspot: this.buildHubspotPayload(variant),

        // The quiz payload is destined for a single field, so hand over the
        // serialised form too rather than making every caller stringify it.
        quizJson: quiz ? JSON.stringify(quiz) : null,
      };
    },
  };
}
