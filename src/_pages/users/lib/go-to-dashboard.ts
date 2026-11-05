/**
 * A full page load of `/dashboard`, after an admin changes their own role: this page is no longer
 * theirs to see, and the shell must be drawn again for the new role. Its own module so a test can
 * replace it, because jsdom cannot navigate.
 */
export const goToDashboard = (): void => {
  window.location.assign("/dashboard");
};
