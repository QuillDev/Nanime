/**
 * Roles of the WAI-ARIA widgets this package composes from plain elements.
 *
 * The file grid is laid out with CSS grid rows, and the destination picker and
 * the sort and filter modes are button groups. Hosts and styles.css target
 * that markup, so it keeps those elements and declares each widget role
 * explicitly instead of switching to table, select or input elements.
 */
export const WidgetRole = {
  rowGroup: "rowgroup",
  row: "row",
  columnHeader: "columnheader",
  gridCell: "gridcell",
  listbox: "listbox",
  option: "option",
  radio: "radio",
  group: "group",
  image: "img",
  status: "status",
} as const;
