export const formatPrice = (val: number | null | undefined) => {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(val);
};

export const formatPct = (val: number | null | undefined) => {
  if (val == null) return "—";
  const formatted = new Intl.NumberFormat("en-IN", {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: "exceptZero",
  }).format(val / 100);
  return formatted;
};

export const formatNumber = (val: number | null | undefined) => {
  if (val == null) return "—";
  return new Intl.NumberFormat("en-IN").format(val);
};
