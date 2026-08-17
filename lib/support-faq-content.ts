// Frequently asked questions for the Support Center (app/(app)/support-faq.tsx).
//
// Long-form prose per language, kept out of the i18n JSON for the same reason as
// legal-content.ts and support-guide-content.ts.
//
// Every question here was actually asked by a student in the assistant chat —
// these are not invented FAQs. Where the honest answer is "no", it says no:
// Kwill does not search the web, PDF sources are stored but not yet read, and
// PDF export lives on the Export screen rather than in the conversation. An FAQ
// that oversells is worse than no FAQ, because the student finds out anyway.
//
// Each language is written natively rather than translated.

export type FaqItem = { q: string; a: string };
export type FaqGroup = { heading: string; items: FaqItem[] };

export type SupportFaq = {
  lead: string;
  groups: FaqGroup[];
  /** Shown under the last group, above the contact button. */
  stillStuckHeading: string;
  stillStuck: string;
};

type Lang = "en" | "fr" | "ar";

// ============================================================
// Arabic
// ============================================================
const AR: SupportFaq = {
  lead: "أسئلة طرحها طلبة قبلك فعلًا. إن لم تجد سؤالك هنا، راسِلنا من الأسفل.",
  groups: [
    {
      heading: "البداية",
      items: [
        {
          q: "كيف أنشئ مذكرة جديدة؟",
          a: "من «مذكرة جديدة» في القائمة الجانبية. سيسألك التطبيق عن مؤسستك ومستواك وتخصّصك وموضوعك، ثم يبني لك خطة أوّلية. كل شيء قابل للتعديل بعد ذلك، فلا تتردّد في الاختيار.",
        },
        {
          q: "عندي ملف Word جاهز، ماذا أفعل؟",
          a: "استعمل «استيراد ودمج». يصبح ملفك هو مذكرتك داخل التطبيق بمحتواه وتنسيقه كما هو. كويل لا يعيد تنسيق مستندك عند الاستيراد — عملك يبقى كما تركته حتى تطلب أنت تغييره.",
        },
        {
          q: "ليس عندي موضوع بعد، هل يساعدني؟",
          a: "نعم. قل له تخصّصك ومستواك واطلب اقتراحات: «اقترح عليّ خمسة مواضيع لمذكرة ماستر في تخصّص كذا، مع سؤال بحث لكل موضوع». ثم اختر واحدًا وابنِ عليه الخطة.",
        },
        {
          q: "بأي لغة أكتب له؟",
          a: "بالعربية أو الفرنسية أو الإنجليزية، وتأتيك الإجابة باللغة التي كتبت بها. ولغة مذكرتك مستقلّة عن لغة سؤالك: يمكنك أن تسأل بالفرنسية عن مذكرة عربية.",
        },
      ],
    },
    {
      heading: "الكتابة",
      items: [
        {
          q: "هل يكتب المذكرة كلها دفعة واحدة؟",
          a: "يستطيع أن يكتب كثيرًا، لكن لا تطلب ذلك. النتيجة تخرج سطحية ومتكرّرة ولن تراجعها. اطلب مبحثًا مبحثًا وراجع كل واحد قبل الانتقال إلى ما بعده.",
        },
        {
          q: "كيف أجعله يكتب في المذكرة لا في المحادثة؟",
          a: "تأكّد من أنّ المذكرة مرتبطة بالمحادثة، ثم قل «اكتبها في المذكرة مباشرة». بدون مذكرة مرتبطة لا يستطيع سوى النصح والتخطيط.",
        },
        {
          q: "كتب شيئًا لا يعجبني، ماذا أفعل؟",
          a: "قل له ما لا يعجبك تحديدًا واطلب إعادة الصياغة، أو اطلب «تراجع». وإن أردت العودة إلى ما قبل عدة تعديلات، افتح السجل من أيقونة الساعة أعلى المحرّر.",
        },
        {
          q: "هل يمكنه تحسين ما كتبتُه بنفسي؟",
          a: "نعم — أكاديمية أكثر، أقصر، أطول، أوضح، أو تصحيح لغوي دون تغيير معناك. حدّد الفقرة بالكلمات وقل ماذا تريد بالضبط.",
        },
      ],
    },
    {
      heading: "التنسيق والهيكلة",
      items: [
        {
          q: "عناويني لا تظهر في الفهرس، لماذا؟",
          a: "لأنها على الأرجح ليست عناوين حقيقية بل نصّ غليظ مكبَّر، وWord لا يراها عناوين. اطلب منه تحويلها إلى عناوين حقيقية بمستوياتها، ثم أعد توليد الفهرس.",
        },
        {
          q: "غيّرت ترويسة قسم فتغيّرت الأقسام التي بعده",
          a: "هذه قاعدة من Word: الأقسام ترث ترويسة ما قبلها. قل له «افصل هذا القسم عن القسم الذي قبله ثم أعد تطبيق ترويسته وحدها».",
        },
        {
          q: "أرقام صفحات الفهرس كلها 1",
          a: "الفهرس حقل حيّ في Word وأرقامه تُحسب عند إعادة الترقيم الفعلية. افتح الملف في Word، انقر على الفهرس بالزر الأيمن ثم «تحديث الحقل».",
        },
        {
          q: "كيف أجعل الترقيم يبدأ من المقدمة؟",
          a: "قل له: «احذف ترقيم الصفحات من كل ما يسبق المقدمة العامة، وابدأ الترقيم من المقدمة برقم 1، ولا ترقّم الصفحات الفاصلة».",
        },
        {
          q: "النص العربي يخرج بمحاذاة خاطئة",
          a: "اطلب الاتجاه صراحةً ولا تفترضه: «اضبط الفقرات بالاتجاه من اليمين إلى اليسار مع محاذاة ضبط». وإن كان الخلل في محتوى مضاف حديثًا فقط، فقل ذلك حتى لا يمسّ البقية.",
        },
      ],
    },
    {
      heading: "الملفات والتصدير",
      items: [
        {
          q: "ما الملفات التي يستطيع قراءتها؟",
          a: "ملفات Word‏ (.docx) و‎.txt و‎.md تُقرأ كاملة وتُحفظ مع مذكرتك، فتسألها الآن ولاحقًا.",
        },
        {
          q: "هل يقرأ ملفات PDF؟",
          a: "لا، ليس بعد. ملف PDF يُحفظ في مصادرك لكن نصّه لا يُستخرج، وكويل يصارحك بذلك بدل أن يخمّن ما فيه. إن كان مرجعك مهمًّا فحوّله إلى Word أولًا.",
        },
        {
          q: "هل يمكنه نقل فصل من ملف آخر إلى مذكرتي؟",
          a: "نعم. أرفق الملف ثم قل: «انقل الفصل النظري كاملًا من الملف المرفق إلى مذكرتي مع الحفاظ على عناوينه». ويستطيع كذلك نقل الأشكال والرسوم البيانية منه.",
        },
        {
          q: "كيف أصدّر إلى PDF؟",
          a: "من شاشة «تصدير» في القائمة الجانبية، حيث تختار Word أو PDF أو LaTeX. المحادثة تعطيك ملف Word فقط.",
        },
      ],
    },
    {
      heading: "الحساب والخصوصية",
      items: [
        {
          q: "هل يستطيع أحد الاطّلاع على مذكرتي؟",
          a: "لا. مذكرتك لك وحدك، ولا يمكن لطالب آخر — ولا لكويل نيابةً عنه — الاطّلاع عليها. وهذا يشمل الطلبات التي تبدو إدارية.",
        },
        {
          q: "هل يبحث في الإنترنت؟",
          a: "لا. يعمل على مذكرتك وعلى المصادر التي ترفعها أنت. أي مرجع لم تعطه إياه يجب أن تتحقّق منه بنفسك قبل الاعتماد عليه.",
        },
        {
          q: "فقدت محتوى، كيف أستعيده؟",
          a: "افتح السجل من أيقونة الساعة أعلى المحرّر وعُد إلى نسخة سابقة، أو قل لكويل «تراجع». التعديلات الواسعة تُعرض عليك للموافقة قبل تنفيذها أصلًا.",
        },
        {
          q: "هل استعمال الذكاء الاصطناعي مسموح في مذكرتي؟",
          a: "ذلك يعود إلى جامعتك، والقواعد تختلف من مؤسسة إلى أخرى. تحقّق من قواعد مؤسستك، وراجع كل ما يكتبه كويل قبل أن تنسبه إلى نفسك — مسؤولية العمل تبقى عليك.",
        },
      ],
    },
  ],
  stillStuckHeading: "لم تجد جوابك؟",
  stillStuck: "راسلنا وصف ما حدث بالضبط. كلّما كان الوصف أدقّ كان الجواب أسرع.",
};

// ============================================================
// French
// ============================================================
const FR: SupportFaq = {
  lead: "Des questions réellement posées par d'autres étudiants. Si la vôtre n'y est pas, écrivez-nous depuis le bas de cette page.",
  groups: [
    {
      heading: "Démarrer",
      items: [
        {
          q: "Comment créer un nouveau mémoire ?",
          a: "Via « Nouveau mémoire » dans le menu latéral. L'application vous demandera votre établissement, votre niveau, votre spécialité et votre sujet, puis construira un premier plan. Tout reste modifiable ensuite, alors n'hésitez pas à choisir.",
        },
        {
          q: "J'ai déjà un fichier Word, que faire ?",
          a: "Utilisez « Importer et fusionner ». Votre fichier devient votre mémoire dans l'application, avec son contenu et sa mise en forme intacts. Kwill ne reformate rien à l'import : votre travail reste tel quel jusqu'à ce que vous demandiez un changement.",
        },
        {
          q: "Je n'ai pas encore de sujet, peut-il m'aider ?",
          a: "Oui. Donnez-lui votre spécialité et votre niveau et demandez des propositions : « Propose-moi cinq sujets de mémoire de master en telle spécialité, avec une question de recherche pour chacun. » Choisissez-en un, puis construisez le plan dessus.",
        },
        {
          q: "Dans quelle langue lui écrire ?",
          a: "En arabe, en français ou en anglais — la réponse vient dans la langue de votre message. La langue de votre mémoire est indépendante : vous pouvez poser une question en français sur un mémoire en arabe.",
        },
      ],
    },
    {
      heading: "Rédaction",
      items: [
        {
          q: "Peut-il écrire tout le mémoire d'un coup ?",
          a: "Il peut en écrire beaucoup, mais ne le demandez pas. Le résultat est superficiel et répétitif, et vous ne le relirez pas. Demandez section par section et relisez chacune avant de passer à la suivante.",
        },
        {
          q: "Comment lui faire écrire dans le mémoire et non dans la conversation ?",
          a: "Vérifiez que le mémoire est bien rattaché à la conversation, puis dites « écris-le directement dans le mémoire ». Sans mémoire rattaché, il ne peut que conseiller et planifier.",
        },
        {
          q: "Il a écrit quelque chose qui ne me plaît pas",
          a: "Dites précisément ce qui ne va pas et demandez une reformulation, ou dites « annule ». Pour revenir plus loin en arrière, ouvrez l'historique via l'horloge en haut de l'éditeur.",
        },
        {
          q: "Peut-il améliorer ce que j'ai écrit moi-même ?",
          a: "Oui — plus académique, plus court, plus long, plus clair, ou une correction de langue sans toucher au sens. Situez le paragraphe avec des mots et dites exactement ce que vous voulez.",
        },
      ],
    },
    {
      heading: "Mise en forme et structure",
      items: [
        {
          q: "Mes titres n'apparaissent pas dans la table des matières",
          a: "Ils ne sont probablement pas de vrais titres, seulement du gras agrandi, et Word ne les reconnaît pas. Demandez-lui de les convertir en vrais titres avec leurs niveaux, puis régénérez la table des matières.",
        },
        {
          q: "J'ai changé un en-tête et les sections suivantes ont changé aussi",
          a: "C'est une règle de Word : une section hérite de l'en-tête de la précédente. Dites-lui « dissocie cette section de la précédente puis réapplique son en-tête à elle seule ».",
        },
        {
          q: "Les numéros de page de la table des matières affichent tous 1",
          a: "C'est un champ vivant dans Word, calculé lors de la repagination réelle. Ouvrez le fichier dans Word, clic droit sur la table des matières puis « Mettre à jour les champs ».",
        },
        {
          q: "Comment faire commencer la pagination à l'introduction ?",
          a: "Dites-lui : « Supprime la pagination de tout ce qui précède l'introduction générale, commence la numérotation à 1 à l'introduction, et ne numérote pas les pages de garde. »",
        },
        {
          q: "L'alignement du texte sort mal",
          a: "Demandez l'alignement explicitement plutôt que de le supposer : « justifie tous les paragraphes ». Si le problème ne touche que du contenu récemment ajouté, précisez-le pour qu'il ne modifie pas le reste.",
        },
      ],
    },
    {
      heading: "Fichiers et export",
      items: [
        {
          q: "Quels fichiers peut-il lire ?",
          a: "Les fichiers Word (.docx), .txt et .md sont lus intégralement et conservés avec votre mémoire : vous pouvez les interroger maintenant et plus tard.",
        },
        {
          q: "Lit-il les PDF ?",
          a: "Pas encore. Un PDF est enregistré dans vos sources mais son texte n'est pas extrait, et Kwill vous le dit franchement plutôt que de deviner son contenu. Si la référence compte, convertissez-la en Word d'abord.",
        },
        {
          q: "Peut-il transférer un chapitre d'un autre fichier ?",
          a: "Oui. Joignez le fichier puis dites : « transfère tout le chapitre théorique du fichier joint vers mon mémoire en conservant ses titres ». Il peut aussi en transférer les figures et les graphiques.",
        },
        {
          q: "Comment exporter en PDF ?",
          a: "Depuis l'écran « Exporter » du menu latéral, où vous choisissez Word, PDF ou LaTeX. La conversation, elle, ne produit qu'un fichier Word.",
        },
      ],
    },
    {
      heading: "Compte et confidentialité",
      items: [
        {
          q: "Quelqu'un peut-il voir mon mémoire ?",
          a: "Non. Votre mémoire n'appartient qu'à vous : aucun autre étudiant — ni Kwill en son nom — ne peut y accéder. Cela vaut aussi pour les demandes qui se présentent comme administratives.",
        },
        {
          q: "Cherche-t-il sur Internet ?",
          a: "Non. Il travaille sur votre mémoire et sur les sources que vous téléversez. Toute référence que vous ne lui avez pas fournie doit être vérifiée par vous avant d'être utilisée.",
        },
        {
          q: "J'ai perdu du contenu, comment le récupérer ?",
          a: "Ouvrez l'historique via l'horloge en haut de l'éditeur et revenez à une version précédente, ou dites « annule ». Les modifications larges vous sont d'ailleurs soumises pour accord avant exécution.",
        },
        {
          q: "L'usage de l'IA est-il autorisé pour mon mémoire ?",
          a: "Cela dépend de votre université, et les règles varient d'un établissement à l'autre. Vérifiez celles de votre institution, et relisez tout ce que Kwill écrit avant de vous l'attribuer — la responsabilité du travail reste la vôtre.",
        },
      ],
    },
  ],
  stillStuckHeading: "Vous n'avez pas trouvé ?",
  stillStuck: "Écrivez-nous en décrivant exactement ce qui s'est passé. Plus la description est précise, plus la réponse est rapide.",
};

// ============================================================
// English
// ============================================================
const EN: SupportFaq = {
  lead: "Questions other students have actually asked. If yours isn't here, write to us from the bottom of this page.",
  groups: [
    {
      heading: "Getting started",
      items: [
        {
          q: "How do I create a new thesis?",
          a: "From \"New thesis\" in the side menu. The app asks for your institution, level, field and topic, then builds a first plan. Everything stays editable afterwards, so don't agonise over the choices.",
        },
        {
          q: "I already have a Word file — what do I do?",
          a: "Use \"Import & combine\". Your file becomes your thesis inside the app with its content and formatting intact. Kwill doesn't reformat anything on import: your work stays as you left it until you ask for a change.",
        },
        {
          q: "I don't have a topic yet — can it help?",
          a: "Yes. Tell it your field and level and ask for options: \"Suggest five master's thesis topics in [field], each with a research question.\" Pick one, then build the plan on it.",
        },
        {
          q: "Which language should I write in?",
          a: "Arabic, French or English — the answer comes back in the language you wrote in. Your thesis language is independent: you can ask in English about an Arabic thesis.",
        },
      ],
    },
    {
      heading: "Writing",
      items: [
        {
          q: "Can it write the whole thesis at once?",
          a: "It can write a lot, but don't ask for that. The result is shallow and repetitive, and you won't review it. Ask section by section and read each one before moving on.",
        },
        {
          q: "How do I make it write in the thesis, not the chat?",
          a: "Make sure a thesis is attached to the conversation, then say \"write it straight into the thesis\". Without an attached thesis it can only advise and plan.",
        },
        {
          q: "It wrote something I don't like",
          a: "Say specifically what's wrong and ask for a rewrite, or say \"undo\". To go further back, open History from the clock at the top of the editor.",
        },
        {
          q: "Can it improve what I wrote myself?",
          a: "Yes — more academic, shorter, longer, clearer, or a language fix that leaves your meaning alone. Point to the paragraph in words and say exactly what you want.",
        },
      ],
    },
    {
      heading: "Formatting and structure",
      items: [
        {
          q: "My headings don't show in the table of contents",
          a: "They're probably not real headings, just enlarged bold text, so Word doesn't recognise them. Ask it to convert them into real headings with their levels, then regenerate the contents.",
        },
        {
          q: "I changed one header and the following sections changed too",
          a: "That's a Word rule: a section inherits the header of the one before it. Say \"unlink this section from the previous one, then reapply its header on its own\".",
        },
        {
          q: "Every page number in the contents shows 1",
          a: "It's a live field in Word, computed when Word actually repaginates. Open the file in Word, right-click the table of contents and choose \"Update field\".",
        },
        {
          q: "How do I start page numbering at the introduction?",
          a: "Say: \"Remove page numbers from everything before the general introduction, start numbering at 1 from the introduction, and don't number the divider pages.\"",
        },
        {
          q: "The text alignment comes out wrong",
          a: "Ask for alignment explicitly rather than assuming it: \"justify every paragraph\". If only recently added content is affected, say so, so it leaves the rest alone.",
        },
      ],
    },
    {
      heading: "Files and export",
      items: [
        {
          q: "Which files can it read?",
          a: "Word (.docx), .txt and .md files are read in full and kept with your thesis, so you can ask about them now and later.",
        },
        {
          q: "Does it read PDFs?",
          a: "Not yet. A PDF is saved to your sources but its text isn't extracted, and Kwill tells you so rather than guessing at the contents. If the reference matters, convert it to Word first.",
        },
        {
          q: "Can it move a chapter from another file into my thesis?",
          a: "Yes. Attach the file, then say: \"move the entire theoretical chapter from the attached file into my thesis, keeping its headings\". It can move figures and charts across too.",
        },
        {
          q: "How do I export to PDF?",
          a: "From the \"Export\" screen in the side menu, where you choose Word, PDF or LaTeX. The conversation itself only produces a Word file.",
        },
      ],
    },
    {
      heading: "Account and privacy",
      items: [
        {
          q: "Can anyone else see my thesis?",
          a: "No. Your thesis is yours alone — no other student, and not Kwill on their behalf, can read it. That holds for requests framed as administrative too.",
        },
        {
          q: "Does it search the internet?",
          a: "No. It works on your thesis and the sources you upload. Any reference you didn't give it must be verified by you before you rely on it.",
        },
        {
          q: "I lost some content — how do I get it back?",
          a: "Open History from the clock at the top of the editor and return to an earlier version, or tell Kwill to undo. Wide edits are put to you for approval before they run in the first place.",
        },
        {
          q: "Is using AI allowed for my thesis?",
          a: "That's up to your university, and the rules differ between institutions. Check your own, and review everything Kwill writes before putting your name to it — responsibility for the work stays with you.",
        },
      ],
    },
  ],
  stillStuckHeading: "Didn't find it?",
  stillStuck: "Write to us describing exactly what happened. The more precise the description, the faster the answer.",
};

const FAQS: Record<Lang, SupportFaq> = { en: EN, fr: FR, ar: AR };

/** The FAQ in the reader's language; anything unrecognised falls back to French. */
export function getSupportFaq(lang: string): SupportFaq {
  const key = (lang || "").slice(0, 2).toLowerCase() as Lang;
  return FAQS[key] ?? FAQS.fr;
}
