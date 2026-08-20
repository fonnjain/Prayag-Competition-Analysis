type SpokenProduct = {
  itemCode: string;
  productName?: string | null;
  currentMrp?: number | null;
  upcomingMrp?: number | null;
  upcomingEffectiveDate?: string | null;
};

type SpokenCompetitor = {
  competitor: string;
  price: number;
  message?: string | null;
};

const SMALL = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = [
  "",
  "",
  "twenty",
  "thirty",
  "forty",
  "fifty",
  "sixty",
  "seventy",
  "eighty",
  "ninety",
];

function integerWords(value: number): string {
  const n = Math.max(0, Math.round(value));
  if (n < 20) return SMALL[n]!;
  if (n < 100) {
    return `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${SMALL[n % 10]}` : ""}`;
  }
  if (n < 1_000) {
    return `${SMALL[Math.floor(n / 100)]} hundred${n % 100 ? ` ${integerWords(n % 100)}` : ""}`;
  }
  if (n < 100_000) {
    return `${integerWords(Math.floor(n / 1_000))} thousand${n % 1_000 ? ` ${integerWords(n % 1_000)}` : ""}`;
  }
  if (n < 10_000_000) {
    return `${integerWords(Math.floor(n / 100_000))} lakh${n % 100_000 ? ` ${integerWords(n % 100_000)}` : ""}`;
  }
  return new Intl.NumberFormat("en-IN").format(n);
}

export function spokenRupees(value: number): string {
  let rupees = Math.round(value);
  let paise = 0;
  if (value < 100) {
    const floor = Math.floor(value);
    const fraction = value - floor;
    if (fraction >= 0.5) {
      rupees = floor;
      paise = Math.round(fraction * 100);
      if (paise === 100) {
        rupees += 1;
        paise = 0;
      }
    }
  }
  return `${integerWords(rupees)} rupees${paise ? ` and ${integerWords(paise)} paise` : ""}`;
}

const ORDINALS = [
  "",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
  "twenty first",
  "twenty second",
  "twenty third",
  "twenty fourth",
  "twenty fifth",
  "twenty sixth",
  "twenty seventh",
  "twenty eighth",
  "twenty ninth",
  "thirtieth",
  "thirty first",
];

function spokenRevisionDate(value: string, now: Date): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.ceil((date.getTime() - today) / 86_400_000);
  const month = new Intl.DateTimeFormat("en-IN", {
    month: "long",
    timeZone: "UTC",
  }).format(date);
  const year = date.getUTCFullYear() === now.getFullYear() ? "" : ` ${date.getUTCFullYear()}`;
  if (days > 30) return `from ${month}${year}`;
  return `on the ${ORDINALS[date.getUTCDate()]} of ${month}${year}`;
}

export function buildSpokenPriceSummary(
  product: SpokenProduct,
  competitors: SpokenCompetitor[],
  now = new Date(),
): string {
  const name = (product.productName || product.itemCode).replace(/\s+/g, " ").trim();
  const sentences = [`${name}.`];

  if (product.currentMrp != null) {
    sentences.push(`Prayag MRP ${spokenRupees(product.currentMrp)}.`);
  }

  if (
    product.currentMrp != null &&
    product.upcomingMrp != null &&
    product.upcomingEffectiveDate &&
    product.upcomingMrp !== product.currentMrp
  ) {
    sentences.push(
      `This changes to ${spokenRupees(product.upcomingMrp)} ${spokenRevisionDate(product.upcomingEffectiveDate, now)}.`,
    );
  }

  if (competitors.length === 1) {
    const competitor = competitors[0]!;
    sentences.push(
      `${competitor.competitor} ${spokenRupees(competitor.price)}.${competitor.message ? ` ${competitor.message}.` : ""}`,
    );
  } else if (competitors.length > 1) {
    const lowest = [...competitors].sort((a, b) => a.price - b.price)[0]!;
    sentences.push(
      `${integerWords(competitors.length)} competitor prices on screen, lowest is ${lowest.competitor} at ${spokenRupees(lowest.price)}.`,
    );
  }

  return sentences.join(" ");
}