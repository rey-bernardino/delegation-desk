// src/features/fields.service.js

export function createFieldsService({ config }) {
  const selector = config.fieldSelector || ".d-field";

  return {
    getFields() {
      return Array.from(document.querySelectorAll(selector));
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
    clearAll() {
      const cleared = this.getFields().filter(
        (field) => !this.isPreserved(field)
      );

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
