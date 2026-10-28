// src/constants/categories.js
// Keep in sync with server/src/modules/items/categories.js
export const ITEM_CATEGORIES = [
  { value: "electronics", label: "Electronics" },
  { value: "books", label: "Books" },
  { value: "sports", label: "Sports" },
  { value: "furniture", label: "Furniture" },
  { value: "appliances", label: "Appliances" },
  { value: "other", label: "Other" },
];

export function categoryLabel(value) {
  return ITEM_CATEGORIES.find((c) => c.value === String(value).toLowerCase())?.label ?? value;
}
