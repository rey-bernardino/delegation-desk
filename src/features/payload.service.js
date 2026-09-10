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
import { groupFields, isMultiGroup } from "../core/field-groups.js";

export function createPayloadService({ config, dom, state }) {
  const settings = config.payload || {};
  const labelSelector = settings.labelSelector || ".d-field-label";
  const wrapperSelector =
    config.validation?.fieldWrapper || ".d-field-container";
  const infoBlockName = settings.infoFormBlock || "info";
  const contactBlockNames = settings.contactFormBlocks || [infoBlockName];
  const categoryKey = settings.categoryKey || "category";
  const fieldSelector = config.fieldSelector || ".d-field";
  const optionLabelSelector =
    settings.optionLabelSelector || ".w-form-label, .d-field-label";
  const labelIgnoreSelector = settings.labelIgnoreSelector ?? ".subtext";

  // Already-warned name collisions, so the warning fires once per set rather
  // than on every payload build.
  const warnedCollisions = new Set();

  // Label text as a human reads it: the nested hint dropped, and whitespace
  // collapsed. <br> contributes nothing to textContent, so without this a
  // label like `Catering<br><span class="subtext">Meals…</span>` flattens to
  // "CateringMeals…" and lands in the sheet header exactly like that.
  function textOf(element) {
    if (!element) {
      return "";
    }

    // Clone, so stripping the hint never touches what is on screen.
    const clone = element.cloneNode(true);

    if (labelIgnoreSelector) {
      clone
        .querySelectorAll(labelIgnoreSelector)
        .forEach((node) => node.remove());
    }

    return (clone.textContent || "").replace(/\s+/g, " ").trim();
  }

  // Two questions in one category answering to the same name collapse into a
  // single key in the summary's flat maps, so one of the two answers is
  // silently dropped from the sheet. It is authored in Webflow, so it can only
  // be fixed there — say so loudly rather than losing an answer quietly.
  function warnOnDuplicateNames(groups, variant) {
    const counts = new Map();

    groups.forEach((group) => {
      counts.set(group.name, (counts.get(group.name) || 0) + 1);
    });

    const clashes = [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([name]) => name);

    if (!clashes.length) {
      return;
    }

    const key = `${variant}:${clashes.join(",")}`;

    if (warnedCollisions.has(key)) {
      return;
    }

    warnedCollisions.add(key);

    console.warn(
      `Delegation Desk: "${variant}" has more than one field named ` +
        `${clashes.map((n) => `"${n}"`).join(", ")}. The summary payload is ` +
        "keyed by name, so only the LAST one reaches Google Sheets — the " +
        "other answer is lost. Rename one of them in Webflow.",
      clashes
    );
  }
  const multiValueSeparator = settings.multiValueSeparator ?? ", ";

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

  // Category form blocks are the scoped ones minus the contact/consent blocks.
  // Blocks with no fields (submit) fall out on their own.
  function categoryBlockNames(variant) {
    return formBlockNamesFor(config, variant).filter(
      (name) => !contactBlockNames.includes(name)
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
      // querySelector, so this is the FIRST .d-field-label in the wrapper.
      // In a group the question's label is authored above the options, whose
      // labels carry the same class — document order is what distinguishes
      // them, so the question label must stay first inside the container.
      const label = field
        .closest(wrapperSelector)
        ?.querySelector(labelSelector);

      return textOf(label) || field.name || "";
    },

    valueOf(field) {
      const type = String(field.type || "").toLowerCase();

      if (type === "checkbox" || type === "radio") {
        return field.checked ? field.value || "true" : "";
      }

      return String(field.value ?? "").trim();
    },

    // Visible contact and consent fields — what a human filled in or ticked.
    getInfoFields() {
      return contactBlockNames.flatMap(fieldsIn);
    },

    // Everything HubSpot should receive: the visible contact and consent
    // fields plus the hidden attribution inputs sitting alongside them.
    getHubspotFields() {
      return contactBlockNames.flatMap(allNamedFieldsIn);
    },

    getCategoryFields(variant = state.selectedVariant) {
      if (!variant) {
        return [];
      }

      return categoryBlockNames(variant).flatMap(fieldsIn);
    },

    // What one option of a pick-any group contributes to the joined answer.
    //
    // Deliberately NOT part of valueOf(): the opt-in checkbox goes through
    // that on its way to HubSpot, and swapping its "on" for the consent
    // sentence would quietly change what lands on the contact record.
    optionValueOf(field) {
      // getAttribute, not .value — an unset value attribute reads back as the
      // browser default "on", which is indistinguishable from a deliberate
      // one and useless in a spreadsheet.
      const authored = (field.getAttribute("value") || "").trim();

      if (authored && authored !== "on") {
        return authored;
      }

      // Webflow authors routinely leave the value alone, so fall back to the
      // option's own visible text. Scoped to the option's own label so it
      // can't pick up the first option's text for every box in the group.
      const holder = field.closest("label") || field.parentElement;
      const optionLabel = holder?.querySelector(optionLabelSelector);
      const text = textOf(optionLabel);

      return text || authored || "true";
    },

    // One value per question. A pick-any group collapses to its ticked
    // options joined into a single cell, rather than N columns of "on".
    valueOfGroup(group) {
      if (!isMultiGroup(group)) {
        return this.valueOf(group.fields[0]);
      }

      return group.fields
        .filter((field) => field.checked)
        .map((field) => this.optionValueOf(field))
        .join(multiValueSeparator);
    },

    // The question's label, off the wrapper the whole group shares.
    labelOfGroup(group) {
      return this.labelOf(group.fields[0]);
    },

    getCategoryGroups(variant = state.selectedVariant) {
      const groups = groupFields(this.getCategoryFields(variant), {
        fieldSelector,
        wrapperSelector,
      });

      warnOnDuplicateNames(groups, variant || "(none)");

      return groups;
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

      payload.answers = this.getCategoryGroups(variant).map((group) => ({
        name: group.name || group.fields[0].name,
        label: this.labelOfGroup(group),
        value: this.valueOfGroup(group),
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

    // Only included when config.hubspot.legalConsent.enabled is true. A form
    // with GDPR options turned on rejects a submission that omits this; a form
    // without them rejects one that includes it. Which way round depends on
    // the HubSpot form, so this is off until that is known.
    //
    // The consent text is read from the opt-in label rather than hardcoded, so
    // it always matches what the user actually agreed to.
    buildLegalConsent() {
      const legal = config.hubspot?.legalConsent;

      if (!legal?.enabled) {
        return null;
      }

      const optinField = document.querySelector(
        `[name="${legal.optinFieldName}"]`
      );

      const label = optinField
        ?.closest(wrapperSelector)
        ?.querySelector(labelSelector);

      // Trim before falling back, or a whitespace-only label produces blank
      // consent text — HubSpot would store an empty record of what was agreed.
      const labelText = (label?.textContent || "").trim();

      return {
        consent: {
          consentToProcess: true,
          text: labelText || legal.fallbackText || "",
          communications: legal.communications || [],
        },
      };
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

      // DO NOT simplify to `context.hutk = getCookie("hubspotutk")`.
      //
      // The key has to be absent, not null or empty. HubSpot rejects the whole
      // submission over a blank hutk, and the cookie legitimately doesn't
      // exist for anyone whose browser blocked it — Brave, Safari ITP, any
      // cookie blocker, or a first visit before HubSpot's script ran. Sending
      // the key regardless fails exactly the users who are hardest to debug.
      // Carried over from athena-form's hubspot.service.js buildContext().
      const hutk = getCookie("hubspotutk");

      if (hutk && String(hutk).trim()) {
        context.hutk = String(hutk).trim();
      }

      const apiPayload = {
        submittedAt: Date.now(),

        // Values are always strings — valueOf() guarantees it — because a null
        // value is rejected the same way a null hutk is.
        fields: Object.entries(flat).map(([name, value]) => ({
          name,
          value: value ?? "",
        })),

        context,
      };

      const consent = this.buildLegalConsent();

      if (consent) {
        apiPayload.legalConsentOptions = consent;
      }

      return apiPayload;
    },

    // Sheets-shaped. Deliberately different from the quiz payload: `fields`
    // and `labels` are flat maps keyed by field name, because a consumer
    // turning this into columns wants `Object.keys(fields)` for the column
    // order and `labels[key]` for the header. JSON preserves key order, so
    // column order stays stable as long as the Webflow markup order does.
    buildSummaryPayload(variant = state.selectedVariant) {
      if (!variant) {
        return null;
      }

      const summarySettings = settings.summary || {};

      const payload = {
        v: summarySettings.version ?? 1,
        [categoryKey]: variant,
        categoryLabel: this.categoryLabelFor(variant),
        submittedAt: new Date().toISOString(),
        contact: {},
        fields: {},
      };

      this.getInfoFields().forEach((field) => {
        payload.contact[field.name] = this.valueOf(field);
      });

      // Grouped, so a pick-any question is one key — the flat map is keyed by
      // field name, so N boxes sharing a name would otherwise overwrite each
      // other down to whichever came last, and the sheet would show one
      // option instead of the set.
      const categoryGroups = this.getCategoryGroups(variant);

      categoryGroups.forEach((group) => {
        payload.fields[group.name] = this.valueOfGroup(group);
      });

      if (summarySettings.includeLabels !== false) {
        payload.labels = {};

        categoryGroups.forEach((group) => {
          payload.labels[group.name] = this.labelOfGroup(group);
        });
      }

      return payload;
    },

    buildSummaryJson(variant = state.selectedVariant) {
      const summary = this.buildSummaryPayload(variant);

      return summary ? JSON.stringify(summary) : null;
    },

    buildAll(variant = state.selectedVariant) {
      const quiz = this.buildQuizPayload(variant);
      const summary = this.buildSummaryPayload(variant);

      return {
        category: variant || null,
        categoryLabel: this.categoryLabelFor(variant),

        summary,
        summaryJson: summary ? JSON.stringify(summary) : null,

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
