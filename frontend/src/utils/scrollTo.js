// Shared helper so header/sidebar "tabs" can jump to the matching panel on
// this single-page dashboard instead of doing nothing. Passing no id (or an
// id that isn't present on the current page, e.g. a Citizen-only panel while
// on the Responder view) just scrolls to the top - it never throws.
export function scrollToSection(id) {
  if (!id) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }

  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}
