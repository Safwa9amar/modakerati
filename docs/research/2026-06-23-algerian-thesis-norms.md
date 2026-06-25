# Algerian LMD Thesis Norms — Research Findings (for Modakerati)

**Date:** 2026-06-23 · **Method:** deep-research workflow (5 search angles → 21 sources fetched → 84 claims → 25 adversarially verified, 19 confirmed / 6 refuted). All quantitative claims are backed by **official primary university PDFs**, verbatim-verified.

> Feeds the thesis-authoring design ([[../specs/2026-06-23-thesis-guided-creation-design.md]]). Goal: produce **norm-compliant `.docx`** files for Algerian students.

---

## ★ The single most important finding (drives the data model)

**There is NO single national Algerian thesis standard.** Every formatting spec (fonts, sizes, margins, spacing, heading sizes, citation style, even component order) is set **per-institution and frequently per-faculty**, with large real variation. The app must model **configurable per-university/faculty "formatting profiles"**, never hard-code one "Algerian standard."

The two strongest axes of variation:

1. **Language / script** — French/Latin vs Arabic/RTL.
2. **Discipline** — science/experimental vs law/humanities.

These two axes (not the university name alone) determine almost everything below.

---

## 1. Standard structure (front → body → back) — *confirmed, consistent across guides*

| Order | French | Arabic | English | Notes |
|---|---|---|---|---|
| Front | Page de garde | الغلاف / صفحة العنوان | Title page | **Mandatory** |
| Front | Remerciements | شكر وتقدير | Acknowledgements | *Optional* |
| Front | Dédicace | إهداء | Dedication | *Optional* |
| Front | Résumé + Mots clés | ملخص + الكلمات المفتاحية | Abstract + Keywords | **Trilingual** — see §3 |
| Front | Sommaire / Table des matières | الفهرس | Table of contents | Mandatory |
| Front | Liste des figures / tableaux / abréviations | قائمة الأشكال / الجداول / المختصرات | Lists of figures/tables/abbreviations | |
| Body | Introduction générale | المقدمة العامة | General introduction | |
| Body | *(optional)* Parties → Chapitres | أقسام → فصول | Parts → Chapters | See §2 |
| Body | Conclusion générale | الخاتمة | General conclusion | |
| Back | Références bibliographiques | قائمة المصادر والمراجع | References | Mandatory |
| Back | Annexes | الملاحق | Appendices | *Optional* |

Sources: Univ Alger 1 (Sciences, 2023); Univ Ouargla (Law, 2024/25).

## 2. Body structure — *two discipline patterns*

- **Science / experimental (IMRAD)** — *optional* three-part scheme, each part may contain chapitres:
  - **Partie I : Synthèse Bibliographique** (الإطار النظري / theoretical)
  - **Partie II : Matériel et Méthodes** (المنهجية / methodology)
  - **Partie III : Résultats et Discussion** (النتائج ومناقشتها / results & discussion)
- **Law / humanities** — nesting hierarchy: **chapitre / فصل → section / مبحث → subsection / مطلب** (≈ numbered `1.` / `1.1.` / `1.1.1.`).
- Otherwise chapters run sequentially (chapitre premier/deuxième/troisième). "Parties" are **optional** (the guides say *peut/peuvent*).

→ Maps directly to our **Section (Partie) → Chapter (Chapitre) → numbered headings (in content)** model.

## 3. Résumé / Abstract — *trilingual, Arabic mandatory*

- **Arabic ملخص is obligatory**; plus French Résumé and/or English Abstract. The résumé is written in the redaction language and **translated into the other admitted languages**.
- Each ~**200 words**, with **5–6 keywords (max)**.
- **Placement varies:** often at the **END / back cover (quatrième couverture)** after Conclusion+Biblio+Annexes (Temouchent, Ouargla, Constantine 3); Alger 1 puts it on the verso of the binding. Treat placement as a profile setting.
- ⚠️ *Refuted:* "exactly 3 résumés, each max 10 lines, each on its own page" (0-3) — do not enforce.

## 4. Formatting — *French/Latin backbone vs Arabic/RTL*

**French / Latin-script (near-universal):**
- A4 portrait, single-sided · **Times New Roman 12** body · **interligne 1.5** · justified · footnotes size 10.
- Margins ~2.5 cm (or asymmetric with **binding margin on the LEFT**).
- Heading sizes (Alger 1): Titre1 = 18, Titre2 = 16, Titre3 = 14, Titre4 = 12 bold, Titre5 = 12 italic *(institution-specific — Constantine 3 uses 14/12)*.

**Arabic / RTL:**
- **Simplified Arabic** (sometimes Traditional Arabic) ~**14–16** body, **12** footnotes; foreign-language passages still **Times New Roman**.
- **Binding margin on the RIGHT** (wider right edge), mirroring RTL.
- Line spacing varies (Ouargla 1.15, El Oued 1 cm) — *per profile*.
- Arabic heading sizes (Ouargla Law): chapters الفصول 18 bold, sections المباحث 16 bold, subsections المطالب 16 bold.

**Page numbering:** lowercase Roman (ii, iii…) before the introduction; Arabic numerals (1, 2, 3…) from the introduction onward, **centered at the bottom**, continuous.

⚠️ *Refuted:* single/Simple (1.0) line spacing as a rule (0-3); a specific right3/left2/top2.5/bottom2 margin set for Constantine 1 (0-3). Don't hard-code these.

## 5. Citations / referencing — *discipline-split (critical for export)*

- **Science / French faculties → APA** (author-date), ISO 690 also accepted. Electronic refs need **"Consulté le" date + URL in `< >`**.
- **Law / humanities (Arabic) → footnote system (التهميش)** at the bottom of each page: *Author, Title, Edition, Publisher, Country, Year, Page*, with **مرجع سابق** (op. cit.) and **المرجع نفسه** (ibid.); Latin sources use **Op. cit. / Ibid.** Explicitly **not** parenthetical APA.

→ The export/`styleMap` must carry a **`citationStyle`** dimension: `"apa"` vs `"footnote-ar"`.

## 6. Production stages (process) — *conventional + one verified difficulty taxonomy*

`choix du sujet` → `problématique` → `questions & hypothèses` → `revue de littérature` → `méthodologie & collecte de données` → `rédaction` → `correction/relecture` → `dépôt` → `soutenance`.

Verified: students struggle **most** with **choix du sujet, problématique, and démarche méthodologique** (attributed expert opinion; treat the difficulty ranking as indicative, not a measured nationwide stat). → The AI should give the most help at topic selection, problem statement, and methodology.

## 7. Implications for Modakerati (how this changes the build)

1. **Template = formatting profile**, keyed by **(university/faculty, language, discipline)** — not one global default. Ship a handful of profiles (see open questions) + a generic French and a generic Arabic profile.
2. Add to the template model: **`discipline`** (`science` | `law-humanities` | `generic`), **`citationStyle`** (`apa` | `footnote-ar`), **`bindingSide`** (`left` | `right`, derived from language), and per-level heading sizes.
3. **Two preset body structures** the plan-generator picks from: science **IMRAD parties** vs law/humanities **chapitre→مبحث→مطلب**.
4. **Résumé**: Arabic always present; FR/EN per profile; placement (front vs back) is a profile flag.
5. **Page numbering** (roman→arabic switch) and **RTL binding-margin mirroring** must be in the export engine.
6. The **AI assistant** should weight help toward topic/problématique/methodology (where students struggle).

## 8. Open questions (not resolved by verified sources)
- Exact `page de garde` fields **verbatim**, and whether they differ across **Licence / Master / Doctorat** (verified sources are mostly Master's).
- `soutenance` norms (jury, mentions passable/bien/très bien/excellent, duration, slides).
- Which **5–10 universities/faculties** to ship as built-in profiles; whether a Ministry (MESRS) national directive exists above the institution level.

## 9. Primary sources (verbatim-verified)
- Univ Alger 1 (Sciences, 2023) — `sciences.univ-alger.dz/.../Modalites-de-redaction-M2-.pdf`
- Univ Kasdi Merbah Ouargla (Law, 2024/25) — `fdsp.univ-ouargla.dz/...دليل_الطالب...الماستر_.pdf`
- Univ Constantine 3 IGTU (2021) — `igtu.univ-constantine3.dz/.../Guide-master-français.pdf`
- Univ Frères Mentouri Constantine 1 (Law, 2020/21) — `fac.umc.edu.dz/droit/.../الجانب الشكلي لإعداد مذكرات التخرج.pdf`
- Univ El Oued (Arabic Lit, 2023/24) — `faculty.univ-eloued.dz/attachment/...pdf`
- ESBA (2024) — `esba.dz/wp-content/uploads/2024/01/GUIDE-METHODOLOGIQUE-...pdf`
- Univ Batna 2 (Pharmacy, 2019/20), Univ M'sila (multi-level guide), Univ Souk Ahras (Arabic methodological guide), Univ Sétif (soutenance), Univ Alger 3 (انجاز مذكرة تخرج).
