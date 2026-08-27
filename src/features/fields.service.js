// src/features/fields.service.js

export function createFieldsService({ config }) {
  const selector = config.fieldSelector || ".d-field";

  return {
    getFields() {
      return Array.from(document.querySelectorAll(selector));
    },

    clearAll() {
      const fields = this.getFields();

      fields.forEach((field) => {
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

      return fields.length;
    },
  };
}
