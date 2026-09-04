// src/features/fields.service.js

export function createFieldsService({ config }) {
  const selector = config.fieldSelector || ".d-field";

  return {
    getFields() {
      return Array.from(document.querySelectorAll(selector));
    },

    // Finds a named input, creating it as a hidden input inside the given
    // form block if the Webflow markup doesn't carry it. Carried over from
    // athena-form's ensureHiddenField: it means a field the code owns can be
    // added without waiting for a Webflow publish, and a deleted one can't
    // silently stop being sent.
    //
    // It goes inside a contact block so the HubSpot payload picks it up — that
    // collects every named input in config.payload.contactFormBlocks — and it
    // deliberately gets no .d-field class, so validation ignores it.
    ensureField(name, blockName) {
      if (!name) {
        return null;
      }

      const existing = document.querySelector(`[name="${name}"]`);

      if (existing) {
        return existing;
      }

      const host = document.querySelector(
        `[form-block="${blockName || config.payload?.infoFormBlock || "info"}"]`
      );

      if (!host) {
        console.warn(
          `Delegation Desk: can't create "${name}" — no block to put it in`
        );
        return null;
      }

      const field = document.createElement("input");

      field.type = "hidden";
      field.name = name;
      field.id = name;

      host.appendChild(field);

      return field;
    },

    // Writes into a named input the quiz owns but the user never sees.
    // Dispatched like a real edit, so anything listening picks it up.
    setValue(name, value, options = {}) {
      if (!name) {
        return null;
      }

      const field =
        options.create === true
          ? this.ensureField(name, options.blockName)
          : document.querySelector(`[name="${name}"]`);

      if (!field) {
        if (options.create !== true) {
          console.warn(`Delegation Desk: no field named "${name}"`);
        }

        return null;
      }

      field.value = value ?? "";

      // Both the property and the attribute, as athena-form does: a value set
      // only as a property is invisible to anything reading the markup.
      field.setAttribute("value", value ?? "");

      field.dispatchEvent(new Event("input", { bubbles: true }));
      field.dispatchEvent(new Event("change", { bubbles: true }));

      return field;
    },

    // Fields inside a preserved block are never cleared. [form-block=info]
    // (name, email, company) is shown for every category, so its answers stay
    // true no matter which category the user switches to.
    isPreserved(field) {
      const preserved = config.preserveFormBlocks || [];
      const holder = field.closest("[form-block]");

      return preserved.includes(holder?.getAttribute("form-block"));
    },

    // Returns the fields it actually cleared, so the caller can reset their
    // validation state too.
    //
    // includePreserved is for a kiosk reset, where the next person must not
    // inherit the previous one's name, email or consent. A category switch
    // uses the default and keeps them.
    clearAll(options = {}) {
      const cleared =
        options.includePreserved === true
          ? this.getFields()
          : this.getFields().filter((field) => !this.isPreserved(field));

      cleared.forEach((field) => {
        const type = (field.type || "").toLowerCase();

        if (type === "checkbox" || type === "radio") {
          field.checked = false;
        } else if (field.tagName === "SELECT") {
          field.selectedIndex = 0;
        } else {
          field.value = "";
        }

        // Webflow interactions and any later validation listen for these — a
        // silent value wipe would leave stale "filled" styling behind.
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
      });

      return cleared;
    },
  };
}
