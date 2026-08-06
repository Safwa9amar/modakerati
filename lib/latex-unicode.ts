// LaTeX → Unicode, natively.
//
// The AI answers about maths in LaTeX (`$P = \sum_{i=1}^{n} P_i V_i$`), and the
// chat is a NATIVE surface — no typesetter, and no room for one: a single answer
// listing a chapter's equations would need a WebView per bullet.
//
// So the chat renders what every other native surface renders: the same Unicode
// linearisation the document's own equations show (DocBlock's `mathSpans`, from the
// server's `ommlToText`). "P=∑ᵢ₌₁ⁿPᵢVᵢ" instead of "$P = \sum_{i=1}^{n} P_i V_i$".
// The Writer still typesets the real thing — this is for talking ABOUT maths.
//
// Pure string work: no MathJax, no network, no WebView, so it runs on every
// streamed chunk without cost and works offline.

const SUPER: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷",
  "8": "⁸", "9": "⁹", "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾",
  n: "ⁿ", i: "ⁱ", a: "ᵃ", b: "ᵇ", c: "ᶜ", d: "ᵈ", e: "ᵉ", k: "ᵏ", m: "ᵐ", p: "ᵖ",
  x: "ˣ", y: "ʸ", T: "ᵀ",
};
const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇",
  "8": "₈", "9": "₉", "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
  a: "ₐ", e: "ₑ", i: "ᵢ", j: "ⱼ", k: "ₖ", l: "ₗ", m: "ₘ", n: "ₙ", o: "ₒ", p: "ₚ",
  r: "ᵣ", s: "ₛ", t: "ₜ", u: "ᵤ", v: "ᵥ", x: "ₓ",
};

// Macro → the character it stands for. Only the ones a thesis actually writes;
// anything unknown falls through as its own name, which is still readable.
const MACROS: Record<string, string> = {
  alpha: "α", beta: "β", gamma: "γ", delta: "δ", epsilon: "ε", varepsilon: "ε",
  zeta: "ζ", eta: "η", theta: "θ", vartheta: "ϑ", iota: "ι", kappa: "κ",
  lambda: "λ", mu: "μ", nu: "ν", xi: "ξ", pi: "π", varpi: "ϖ", rho: "ρ",
  varrho: "ϱ", sigma: "σ", varsigma: "ς", tau: "τ", upsilon: "υ", phi: "φ",
  varphi: "ϕ", chi: "χ", psi: "ψ", omega: "ω",
  Gamma: "Γ", Delta: "Δ", Theta: "Θ", Lambda: "Λ", Xi: "Ξ", Pi: "Π", Sigma: "Σ",
  Upsilon: "Υ", Phi: "Φ", Psi: "Ψ", Omega: "Ω",
  infty: "∞", pm: "±", mp: "∓", times: "×", div: "÷", cdot: "·", ast: "∗",
  leq: "≤", le: "≤", geq: "≥", ge: "≥", neq: "≠", ne: "≠", approx: "≈",
  equiv: "≡", sim: "∼", propto: "∝", partial: "∂", nabla: "∇",
  to: "→", rightarrow: "→", leftarrow: "←", leftrightarrow: "↔",
  Rightarrow: "⇒", Leftrightarrow: "⇔", in: "∈", notin: "∉",
  subset: "⊂", supset: "⊃", cup: "∪", cap: "∩", forall: "∀", exists: "∃",
  circ: "∘", perp: "⊥", angle: "∠", degree: "°", ldots: "…", dots: "…", cdots: "⋯",
  sum: "∑", prod: "∏", coprod: "∐", int: "∫", iint: "∬", iiint: "∭", oint: "∮",
  bigcup: "⋃", bigcap: "⋂",
  quad: " ", qquad: "  ", ",": " ", ";": " ", ":": " ", "!": "", " ": " ",
  lbrace: "{", rbrace: "}", langle: "⟨", rangle: "⟩", "|": "|", backslash: "\\",
  "%": "%", "&": "&", "#": "#", $: "$", _: "_", "{": "{", "}": "}",
};

// Set upright and spaced, like TeX does — `sin θ`, not `sinθ`.
const FUNCTIONS = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "log", "ln", "lg", "exp", "det", "dim", "gcd",
  "max", "min", "sup", "inf", "lim", "limsup", "liminf", "arg", "deg", "ker",
]);
// Marks that go AFTER the symbol as a combining character.
const ACCENTS: Record<string, string> = {
  bar: "̅", overline: "̅", underline: "̲", hat: "̂", widehat: "̂", tilde: "̃",
  widetilde: "̃", vec: "⃗", dot: "̇", ddot: "̈", check: "̌", breve: "̆",
  acute: "́", grave: "̀",
};

/** Map to real Unicode scripts when EVERY character has one, else bracket it. */
function script(s: string, map: Record<string, string>, marker: string): string {
  if (!s) return "";
  const mapped = [...s].map((c) => map[c]);
  if (mapped.every(Boolean)) return mapped.join("");
  return s.length === 1 ? marker + s : `${marker}(${s})`;
}

/** Bracket unless it is already atomic — keeps `a/b` and `(a+b)/c` both right.
 *  A single character never needs them, whatever it is: `∂/∂a`, not `(∂)/(∂a)`. */
const wrap = (s: string): string =>
  [...s].length === 1 || /^[\p{L}\p{N}.]*$/u.test(s) ? s : `(${s})`;

class Scanner {
  private s: string;
  private i = 0;
  constructor(src: string) {
    this.s = src;
  }
  private eof(): boolean {
    return this.i >= this.s.length;
  }
  private skipSpace(): void {
    while (!this.eof() && /\s/.test(this.s[this.i])) this.i++;
  }
  /** The next ARGUMENT: a `{…}` group, a single character, or a macro. */
  private arg(): string {
    this.skipSpace();
    if (this.eof()) return "";
    if (this.s[this.i] === "{") return this.group();
    if (this.s[this.i] === "\\") return this.macro();
    return this.s[this.i++];
  }
  /** A balanced `{…}`, converted. */
  private group(): string {
    this.i++; // {
    let depth = 1;
    const start = this.i;
    while (!this.eof() && depth > 0) {
      const c = this.s[this.i];
      if (c === "\\") this.i += 2;
      else {
        if (c === "{") depth++;
        else if (c === "}") depth--;
        this.i++;
      }
    }
    return convertRaw(this.s.slice(start, this.i - 1));
  }
  /** An optional `[…]` argument (the root degree). */
  private optional(): string {
    this.skipSpace();
    if (this.s[this.i] !== "[") return "";
    const end = this.s.indexOf("]", this.i);
    if (end === -1) return "";
    const inner = this.s.slice(this.i + 1, end);
    this.i = end + 1;
    return convertRaw(inner);
  }
  private macro(): string {
    this.i++; // backslash
    const m = /^[a-zA-Z]+|^./.exec(this.s.slice(this.i));
    if (!m) return "";
    const name = m[0];
    this.i += name.length;
    // TeX eats the whitespace after a CONTROL WORD — it separates the name from
    // what follows, it is not a space in the output. Without this, `2\pi r` reads
    // as "2π r" and `\partial a` as "∂ a".
    if (/^[a-zA-Z]+$/.test(name)) this.skipSpace();

    if (name === "frac" || name === "dfrac" || name === "tfrac") {
      return `${wrap(this.arg())}/${wrap(this.arg())}`;
    }
    if (name === "sqrt") {
      const deg = this.optional();
      const body = wrap(this.arg());
      return deg ? `${script(deg, SUPER, "^")}√${body}` : `√${body}`;
    }
    if (name === "text" || name === "mathrm" || name === "textrm" || name === "mathbf" || name === "operatorname") {
      return this.arg();
    }
    if (ACCENTS[name]) return this.arg() + ACCENTS[name];
    if (name === "left" || name === "right") {
      // The delimiter itself follows; `.` means "no bracket on this side".
      this.skipSpace();
      const d = this.s[this.i] === "\\" ? this.macro() : this.s[this.i++];
      return d === "." ? "" : d;
    }
    if (name === "begin" || name === "end") {
      const env = this.arg(); // consume the environment name
      // A cases/matrix opens with a brace in Word too; rows are handled by the
      // `\\` and `&` separators below.
      return name === "begin" && env === "cases" ? "{" : "";
    }
    if (FUNCTIONS.has(name)) return name + " ";
    if (name in MACROS) return MACROS[name];
    return name; // unknown macro: its name is still more readable than nothing
  }

  run(): string {
    let out = "";
    while (!this.eof()) {
      const c = this.s[this.i];
      if (c === "\\") {
        // `\\` is a row break inside cases/matrix.
        if (this.s[this.i + 1] === "\\") {
          this.i += 2;
          out += "; ";
          continue;
        }
        out += this.macro();
        continue;
      }
      if (c === "{") {
        out += this.group();
        continue;
      }
      if (c === "}") {
        this.i++;
        continue;
      }
      if (c === "^") {
        this.i++;
        out += script(this.arg(), SUPER, "^");
        continue;
      }
      if (c === "_") {
        this.i++;
        out += script(this.arg(), SUB, "_");
        continue;
      }
      if (c === "&") {
        this.i++;
        out += " ";
        continue;
      }
      if (c === "~") {
        this.i++;
        out += " ";
        continue;
      }
      this.i++;
      out += c;
    }
    return out;
  }
}

// Relations get breathing room, the way TeX spaces them — and the way a reader
// needs them: "G ≥ G_c", never "G≥G_c". Source spacing can't be relied on for this
// (a control word swallows the space after it), so it is applied on the way out.
// Binary +/− are deliberately left alone: they are unary as often as not, and
// "(-b ± √…)" must not become "( - b ± √…)".
const RELATIONS = /\s*([=≠≤≥≈≡∼∝→←↔⇒⇔∈∉⊂⊃])\s*/g;

/** Convert without the presentation pass — what nested groups use, so relation
 *  spacing can never leak into a SUBSCRIPT (`\sum_{i=1}` must stay "∑ᵢ₌₁", and a
 *  space there is unmappable, which would demote it to "∑_(i = 1)"). */
function convertRaw(src: string): string {
  return new Scanner(src).run();
}

/** One LaTeX maths fragment as readable Unicode. Never throws. */
export function latexToUnicode(latex: string): string {
  try {
    return convertRaw(latex)
      .replace(RELATIONS, " $1 ")
      .replace(/[ \t]+/g, " ")
      .trim();
  } catch {
    return latex;
  }
}

// A `$…$` / `$$…$$` / `\(…\)` / `\[…\]` span. `$` is deliberately strict: an
// answer mentioning "$5" and "$10" must NOT have the words between them eaten as
// an equation, so a span only counts as maths when it carries a macro or a script.
const MATH_SPAN =
  /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$([^$\n]+?)\$|\\\(([\s\S]+?)\\\)/g;
const LOOKS_MATHY = /[\\^_]/;

export type MathChunk = { text: string; math: boolean };

/**
 * Split text into prose and maths. Returns a single non-math chunk when there is
 * no maths in it, so the caller can skip the whole path — which is the common case
 * for a chat message.
 *
 * Streaming-safe: an unterminated `$` simply doesn't match, so a half-arrived
 * formula stays literal until its closing delimiter turns up.
 */
export function splitMath(text: string): MathChunk[] {
  if (!text.includes("$") && !text.includes("\\(") && !text.includes("\\[")) {
    return [{ text, math: false }];
  }
  const out: MathChunk[] = [];
  let last = 0;
  MATH_SPAN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MATH_SPAN.exec(text)) !== null) {
    const inner = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    // `$5 and $10` — a pair of currency signs, not an equation.
    if (m[3] !== undefined && !LOOKS_MATHY.test(inner)) continue;
    if (m.index > last) out.push({ text: text.slice(last, m.index), math: false });
    out.push({ text: latexToUnicode(inner), math: true });
    last = m.index + m[0].length;
  }
  if (!out.length) return [{ text, math: false }];
  if (last < text.length) out.push({ text: text.slice(last), math: false });
  return out;
}
