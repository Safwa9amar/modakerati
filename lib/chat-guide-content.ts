// The "what can Kwill do" guide, opened from the empty conversation.
//
// Kept out of the i18n JSON for the same reason the legal documents are (see
// legal-content.ts): this is long-form prose rendered verbatim per language, not
// interpolated UI strings, and those files are already carrying ~155 duplicate
// keys each. Only the header title and the button label live in locales/.
//
// Everything claimed here must be something the app actually does today. When a
// capability lands or changes, this file is part of the change.

/** Which lucide glyph the screen puts on a section — mapped in chat-guide.tsx. */
export type GuideIcon =
  | "write"
  | "structure"
  | "format"
  | "objects"
  | "cite"
  | "sources"
  | "ask"
  | "edits"
  | "controls";

export type GuideItem = { title: string; body: string };
export type GuideSection = { icon: GuideIcon; heading: string; items: GuideItem[] };

export type ChatGuide = {
  /** Lead paragraph under the header, before the first card. */
  lead: string;
  sections: GuideSection[];
  examplesHeading: string;
  /** Prompts a student can copy word for word — written in the reader's language. */
  examples: string[];
  noteHeading: string;
  note: string;
};

type Lang = "en" | "fr" | "ar";

// ============================================================
// English
// ============================================================
const EN: ChatGuide = {
  lead: "Kwill writes inside your thesis document — it doesn't hand you text to copy and paste. Attach a thesis to the conversation and every answer can become a real edit to the real file.",
  sections: [
    {
      icon: "write",
      heading: "Writing",
      items: [
        {
          title: "Draft from your plan",
          body: "Ask for a paragraph, a section or a whole chapter and it writes it into your document, in the language your thesis is written in.",
        },
        {
          title: "Rewrite what you already have",
          body: "Make a passage more academic, shorter, longer, clearer — or fix the grammar without changing your meaning.",
        },
        {
          title: "Summarize and translate",
          body: "Condense a long passage, or move a section between Arabic, French and English.",
        },
      ],
    },
    {
      icon: "structure",
      heading: "Structure",
      items: [
        {
          title: "Build and reshape the plan",
          body: "Propose a chapter plan, add or rename sections, split one that grew too long, merge two that say the same thing.",
        },
        {
          title: "Headings and numbering",
          body: "Promote or demote a heading, renumber the chapters, make the levels consistent across the whole document.",
        },
        {
          title: "Tables of contents",
          body: "Generate the table of contents, the list of figures and the list of tables, and refresh them after you change things.",
        },
      ],
    },
    {
      icon: "format",
      heading: "Formatting",
      items: [
        {
          title: "The way Word does it",
          body: "Fonts, sizes, line spacing, indents, alignment, margins and page setup — applied as real Word formatting, so it survives export.",
        },
        {
          title: "Pages and chrome",
          body: "Cover page, headers and footers, page numbers, section breaks and divider pages between chapters.",
        },
        {
          title: "Arabic done properly",
          body: "Right-to-left paragraphs, Arabic fonts and mirrored margins are set the way Word expects, not faked with alignment.",
        },
      ],
    },
    {
      icon: "objects",
      heading: "Tables, images, equations",
      items: [
        {
          title: "Tables",
          body: "Insert a table, add or delete rows and columns, format the header row, fill it from what you dictate.",
        },
        {
          title: "Images and figures",
          body: "Send a photo and ask for it to be placed in the document, with a numbered caption and the right position on the page.",
        },
        {
          title: "Equations and charts",
          body: "Insert real Word equations, and build charts from figures you give it.",
        },
      ],
    },
    {
      icon: "cite",
      heading: "Citations and references",
      items: [
        {
          title: "Cite as you write",
          body: "Ask for a citation where you need one and it inserts it, then keeps the bibliography in step.",
        },
        {
          title: "One consistent style",
          body: "Say which style your university requires and it applies the same one everywhere.",
        },
      ],
    },
    {
      icon: "sources",
      heading: "Your own files",
      items: [
        {
          title: "Attach a document and ask about it",
          body: "A Word file (.docx), a .txt or a .md is read in full and kept with your thesis, so you can ask about it now and later.",
        },
        {
          title: "PDFs are stored, not yet read",
          body: "A PDF is saved to your sources, but its text isn't extracted yet — Kwill will say so rather than guess at what's inside.",
        },
        {
          title: "Reuse a figure from an old file",
          body: "Ask it to take a figure out of a document you attached and put it into your thesis.",
        },
      ],
    },
    {
      icon: "ask",
      heading: "How to ask",
      items: [
        {
          title: "Attach the thesis first",
          body: "Without one, Kwill can only advise and plan. With one attached it can read and change the document itself.",
        },
        {
          title: "Say where in words",
          body: '"In the introduction", "the paragraph about the sample", "the last table in chapter two" — you never need a number, and Kwill will link the exact place back to you.',
        },
        {
          title: "One job per message",
          body: "A single clear instruction lands better than a list of ten. Send the next one when the first is done.",
        },
        {
          title: "Say how you want it",
          body: 'Length, tone, level of formality: "about 200 words, academic Arabic, no bullet points".',
        },
        {
          title: "Write in any of the three languages",
          body: "Ask in Arabic, French or English and the reply comes back in the language you used.",
        },
        {
          title: "Its questions are optional",
          body: "When Kwill asks you something you can answer it or dismiss it and just say what you want instead.",
        },
      ],
    },
    {
      icon: "edits",
      heading: "When it edits your thesis",
      items: [
        {
          title: "The change is real",
          body: "There is no separate draft — the document you open in the writer is the one it just edited.",
        },
        {
          title: "Tap the link to see it",
          body: "When an answer names a place in your thesis, that name is a link. Tap it and the writer opens exactly there.",
        },
        {
          title: "Risky changes ask first",
          body: "Anything that deletes or replaces a large part of the document is shown to you for approval before it happens.",
        },
        {
          title: "Nothing is permanent",
          body: "Ask it to undo, or open the history from the clock at the top of the writer and go back to an earlier version.",
        },
      ],
    },
    {
      icon: "controls",
      heading: "The buttons around the chat",
      items: [
        {
          title: "+ (next to the box)",
          body: "Attach a document, send a photo from your gallery, take one with the camera, or paste an image you copied.",
        },
        {
          title: "The clock, top right",
          body: "All your conversations. Start a new one, rename, pin or archive an old one.",
        },
        {
          title: "Under an answer",
          body: "Listen reads it aloud, Regenerate asks again, View full opens a long answer on its own page.",
        },
        {
          title: "Stop",
          body: "While it is working, the send button becomes Stop and ends the turn immediately.",
        },
      ],
    },
  ],
  examplesHeading: "Try asking",
  examples: [
    "Write the general introduction from my plan, about 400 words.",
    "Make the second paragraph of the theoretical chapter more academic.",
    "Add a table comparing the three approaches, with a caption.",
    "Fix the formatting of the whole document: Traditional Arabic 14, 1.5 line spacing.",
    "Generate the table of contents and the list of figures.",
    "Read the file I just attached and tell me what I can use in chapter two.",
  ],
  noteHeading: "Worth knowing",
  note: "Kwill is an assistant, not a supervisor. Check the facts, the numbers and every reference before you submit — you are responsible for the work, and your university's rules on AI still apply. A long job can take a minute, and it needs an internet connection.",
};

// ============================================================
// French
// ============================================================
const FR: ChatGuide = {
  lead: "Kwill écrit directement dans votre mémoire — il ne vous donne pas du texte à copier-coller. Rattachez un mémoire à la conversation et chaque réponse peut devenir une vraie modification du fichier.",
  sections: [
    {
      icon: "write",
      heading: "Rédaction",
      items: [
        {
          title: "Rédiger à partir de votre plan",
          body: "Demandez un paragraphe, une section ou un chapitre entier : il l'écrit dans votre document, dans la langue de votre mémoire.",
        },
        {
          title: "Réécrire ce que vous avez déjà",
          body: "Rendre un passage plus académique, plus court, plus long, plus clair — ou corriger la langue sans changer votre sens.",
        },
        {
          title: "Résumer et traduire",
          body: "Condenser un long passage, ou faire passer une section de l'arabe au français ou à l'anglais.",
        },
      ],
    },
    {
      icon: "structure",
      heading: "Structure",
      items: [
        {
          title: "Construire et remanier le plan",
          body: "Proposer un plan de chapitres, ajouter ou renommer des sections, scinder celle qui a trop grossi, fusionner deux qui se répètent.",
        },
        {
          title: "Titres et numérotation",
          body: "Monter ou descendre un titre de niveau, renuméroter les chapitres, rendre les niveaux cohérents dans tout le document.",
        },
        {
          title: "Sommaires",
          body: "Générer la table des matières, la liste des figures et celle des tableaux, puis les mettre à jour après vos modifications.",
        },
      ],
    },
    {
      icon: "format",
      heading: "Mise en forme",
      items: [
        {
          title: "À la manière de Word",
          body: "Polices, tailles, interlignes, retraits, alignement, marges et mise en page — appliqués comme une vraie mise en forme Word, qui survit à l'export.",
        },
        {
          title: "Pages et habillage",
          body: "Page de garde, en-têtes et pieds de page, numéros de page, sauts de section et pages de séparation entre les chapitres.",
        },
        {
          title: "L'arabe correctement",
          body: "Paragraphes de droite à gauche, polices arabes et marges inversées sont réglés comme Word l'attend, pas simulés par un alignement.",
        },
      ],
    },
    {
      icon: "objects",
      heading: "Tableaux, images, équations",
      items: [
        {
          title: "Tableaux",
          body: "Insérer un tableau, ajouter ou supprimer des lignes et des colonnes, mettre en forme la ligne d'en-tête, le remplir sous votre dictée.",
        },
        {
          title: "Images et figures",
          body: "Envoyez une photo et demandez son insertion dans le document, avec une légende numérotée et la bonne position dans la page.",
        },
        {
          title: "Équations et graphiques",
          body: "Insérer de vraies équations Word, et construire des graphiques à partir des chiffres que vous donnez.",
        },
      ],
    },
    {
      icon: "cite",
      heading: "Citations et références",
      items: [
        {
          title: "Citer au fil de l'écriture",
          body: "Demandez une citation là où il en faut une : il l'insère et tient la bibliographie à jour.",
        },
        {
          title: "Un seul style, partout",
          body: "Indiquez le style exigé par votre université et il l'applique de la même façon dans tout le mémoire.",
        },
      ],
    },
    {
      icon: "sources",
      heading: "Vos propres fichiers",
      items: [
        {
          title: "Joindre un document et l'interroger",
          body: "Un fichier Word (.docx), un .txt ou un .md est lu en entier et conservé avec votre mémoire : vous pouvez l'interroger maintenant et plus tard.",
        },
        {
          title: "Les PDF sont conservés, pas encore lus",
          body: "Un PDF est enregistré dans vos sources, mais son texte n'est pas encore extrait — Kwill vous le dira au lieu de deviner son contenu.",
        },
        {
          title: "Réutiliser une figure d'un ancien fichier",
          body: "Demandez-lui de reprendre une figure d'un document joint et de la placer dans votre mémoire.",
        },
      ],
    },
    {
      icon: "ask",
      heading: "Comment demander",
      items: [
        {
          title: "Rattachez d'abord le mémoire",
          body: "Sans mémoire, Kwill ne peut que conseiller et planifier. Avec un mémoire rattaché, il lit et modifie le document lui-même.",
        },
        {
          title: "Dites où, avec des mots",
          body: "« dans l'introduction », « le paragraphe sur l'échantillon », « le dernier tableau du chapitre deux » — aucun numéro n'est nécessaire, et Kwill vous renverra un lien vers l'endroit exact.",
        },
        {
          title: "Une tâche par message",
          body: "Une consigne claire passe mieux qu'une liste de dix. Envoyez la suivante quand la première est faite.",
        },
        {
          title: "Dites comment vous le voulez",
          body: "Longueur, ton, niveau de langue : « environ 200 mots, en arabe académique, sans puces ».",
        },
        {
          title: "Écrivez dans l'une des trois langues",
          body: "Demandez en arabe, en français ou en anglais : la réponse revient dans la langue que vous avez utilisée.",
        },
        {
          title: "Ses questions sont facultatives",
          body: "Quand Kwill vous pose une question, vous pouvez y répondre ou l'écarter et dire simplement ce que vous voulez.",
        },
      ],
    },
    {
      icon: "edits",
      heading: "Quand il modifie votre mémoire",
      items: [
        {
          title: "La modification est réelle",
          body: "Il n'y a pas de brouillon à part — le document que vous ouvrez dans l'éditeur est celui qu'il vient de modifier.",
        },
        {
          title: "Touchez le lien pour voir",
          body: "Quand une réponse nomme un endroit de votre mémoire, ce nom est un lien. Touchez-le et l'éditeur s'ouvre exactement là.",
        },
        {
          title: "Les modifications risquées demandent votre accord",
          body: "Tout ce qui supprime ou remplace une grande partie du document vous est présenté pour approbation avant d'être appliqué.",
        },
        {
          title: "Rien n'est définitif",
          body: "Demandez-lui d'annuler, ou ouvrez l'historique par l'horloge en haut de l'éditeur et revenez à une version antérieure.",
        },
      ],
    },
    {
      icon: "controls",
      heading: "Les boutons autour du chat",
      items: [
        {
          title: "+ (à côté du champ)",
          body: "Joindre un document, envoyer une photo de la galerie, en prendre une avec l'appareil, ou coller une image copiée.",
        },
        {
          title: "L'horloge, en haut",
          body: "Toutes vos conversations. En démarrer une nouvelle, renommer, épingler ou archiver une ancienne.",
        },
        {
          title: "Sous une réponse",
          body: "Écouter la lit à voix haute, Régénérer redemande, Voir tout ouvre une longue réponse en pleine page.",
        },
        {
          title: "Arrêter",
          body: "Pendant qu'il travaille, le bouton d'envoi devient Arrêter et met fin au tour immédiatement.",
        },
      ],
    },
  ],
  examplesHeading: "Essayez de demander",
  examples: [
    "Rédige l'introduction générale à partir de mon plan, environ 400 mots.",
    "Rends le deuxième paragraphe du chapitre théorique plus académique.",
    "Ajoute un tableau comparant les trois approches, avec une légende.",
    "Corrige la mise en forme de tout le document : Traditional Arabic 14, interligne 1,5.",
    "Génère la table des matières et la liste des figures.",
    "Lis le fichier que je viens de joindre et dis-moi ce que je peux utiliser au chapitre deux.",
  ],
  noteHeading: "Bon à savoir",
  note: "Kwill est un assistant, pas un encadreur. Vérifiez les faits, les chiffres et chaque référence avant de rendre votre travail — vous en restez responsable, et les règles de votre université sur l'IA s'appliquent toujours. Une tâche longue peut prendre une minute, et une connexion internet est nécessaire.",
};

// ============================================================
// Arabic
// ============================================================
const AR: ChatGuide = {
  lead: "كويل يكتب داخل مذكرتك مباشرة — لا يعطيك نصًّا لتنسخه وتلصقه. اربط المذكرة بالمحادثة، وعندها يمكن لكل إجابة أن تتحوّل إلى تعديل حقيقي في الملف نفسه.",
  sections: [
    {
      icon: "write",
      heading: "الكتابة",
      items: [
        {
          title: "الصياغة انطلاقًا من خطتك",
          body: "اطلب فقرة أو مبحثًا أو فصلًا كاملًا، فيكتبه في مستندك وبلغة مذكرتك.",
        },
        {
          title: "إعادة صياغة ما كتبته",
          body: "اجعل الفقرة أكثر أكاديمية، أو أقصر، أو أطول، أو أوضح — أو صحّح اللغة دون تغيير معناك.",
        },
        {
          title: "التلخيص والترجمة",
          body: "اختصر مقطعًا طويلًا، أو انقل مبحثًا بين العربية والفرنسية والإنجليزية.",
        },
      ],
    },
    {
      icon: "structure",
      heading: "الهيكلة",
      items: [
        {
          title: "بناء الخطة وتعديلها",
          body: "اقتراح خطة فصول، إضافة مباحث أو إعادة تسميتها، تقسيم مبحث طال أكثر من اللازم، ودمج مبحثين يكرّران المعنى نفسه.",
        },
        {
          title: "العناوين والترقيم",
          body: "رفع مستوى عنوان أو خفضه، إعادة ترقيم الفصول، وتوحيد المستويات في المستند كله.",
        },
        {
          title: "الفهارس",
          body: "توليد فهرس المحتويات وقائمة الأشكال وقائمة الجداول، وتحديثها بعد كل تغيير.",
        },
      ],
    },
    {
      icon: "format",
      heading: "التنسيق",
      items: [
        {
          title: "تنسيق Word حقيقي",
          body: "الخطوط والأحجام والتباعد والمسافات البادئة والمحاذاة والهوامش وإعداد الصفحة — تُطبَّق كتنسيق Word فعلي يبقى بعد التصدير.",
        },
        {
          title: "الصفحات والإطار",
          body: "صفحة الغلاف، الرؤوس والتذييلات، أرقام الصفحات، فواصل الأقسام، وصفحات الفصل بين الفصول.",
        },
        {
          title: "العربية كما ينبغي",
          body: "اتجاه الفقرات من اليمين إلى اليسار، والخطوط العربية، والهوامش المعكوسة تُضبط كما يتوقّعها Word، لا بمجرّد محاذاة.",
        },
      ],
    },
    {
      icon: "objects",
      heading: "الجداول والصور والمعادلات",
      items: [
        {
          title: "الجداول",
          body: "إدراج جدول، إضافة صفوف وأعمدة أو حذفها، تنسيق صف العناوين، وملؤه بما تمليه عليه.",
        },
        {
          title: "الصور والأشكال",
          body: "أرسل صورة واطلب إدراجها في المستند، مع تسمية توضيحية مرقّمة وموضع مناسب في الصفحة.",
        },
        {
          title: "المعادلات والرسوم البيانية",
          body: "إدراج معادلات Word حقيقية، وبناء رسوم بيانية من الأرقام التي تعطيها له.",
        },
      ],
    },
    {
      icon: "cite",
      heading: "الاستشهادات والمراجع",
      items: [
        {
          title: "الاستشهاد أثناء الكتابة",
          body: "اطلب استشهادًا حيث تحتاجه فيدرجه، ويُبقي قائمة المراجع متوافقة معه.",
        },
        {
          title: "أسلوب واحد موحّد",
          body: "قل له أيّ أسلوب توثيق تشترطه جامعتك، فيطبّقه نفسه في كل المذكرة.",
        },
      ],
    },
    {
      icon: "sources",
      heading: "ملفاتك الخاصة",
      items: [
        {
          title: "أرفق مستندًا واسأل عنه",
          body: "ملف Word‏ (.docx) أو ‎.txt أو ‎.md يُقرأ كاملًا ويُحفظ مع مذكرتك، فتسأل عنه الآن ولاحقًا.",
        },
        {
          title: "ملفات PDF تُحفظ ولا تُقرأ بعد",
          body: "ملف PDF يُحفظ في مصادرك، لكن نصّه لا يُستخرج بعد — وكويل يصارحك بذلك بدل أن يخمّن ما فيه.",
        },
        {
          title: "إعادة استعمال شكل من ملف قديم",
          body: "اطلب منه أخذ شكل من مستند أرفقته ووضعه في مذكرتك.",
        },
      ],
    },
    {
      icon: "ask",
      heading: "كيف تطلب",
      items: [
        {
          title: "اربط المذكرة أولًا",
          body: "بدون مذكرة، لا يستطيع كويل سوى النصح والتخطيط. ومع مذكرة مرتبطة، يقرأ المستند ويعدّله بنفسه.",
        },
        {
          title: "حدّد المكان بالكلمات",
          body: "«في المقدمة»، «الفقرة التي تتحدث عن العيّنة»، «آخر جدول في الفصل الثاني» — لا تحتاج إلى أي رقم، وكويل سيعيد إليك رابطًا إلى الموضع بالضبط.",
        },
        {
          title: "مهمة واحدة في كل رسالة",
          body: "تعليمة واحدة واضحة أنجع من قائمة من عشر. أرسل التالية بعد أن تنتهي الأولى.",
        },
        {
          title: "قل كيف تريده",
          body: "الطول والنبرة ومستوى اللغة: «نحو 200 كلمة، بعربية أكاديمية، دون نقاط».",
        },
        {
          title: "اكتب بأي من اللغات الثلاث",
          body: "اسأل بالعربية أو الفرنسية أو الإنجليزية، وتأتيك الإجابة باللغة التي كتبت بها.",
        },
        {
          title: "أسئلته اختيارية",
          body: "حين يسألك كويل سؤالًا، لك أن تجيب أو أن تتجاهله وتقول ما تريده مباشرة.",
        },
      ],
    },
    {
      icon: "edits",
      heading: "حين يعدّل مذكرتك",
      items: [
        {
          title: "التعديل حقيقي",
          body: "لا توجد نسخة مسوّدة منفصلة — المستند الذي تفتحه في المحرّر هو الذي عدّله للتوّ.",
        },
        {
          title: "المس الرابط لترى",
          body: "حين تذكر الإجابة موضعًا في مذكرتك، فذلك الاسم رابط. المسه ليفتح المحرّر عند الموضع نفسه.",
        },
        {
          title: "التعديلات الخطرة تُعرض عليك أولًا",
          body: "كل ما يحذف أو يستبدل جزءًا كبيرًا من المستند يُعرض عليك للموافقة قبل تنفيذه.",
        },
        {
          title: "لا شيء نهائي",
          body: "اطلب منه التراجع، أو افتح السجلّ من أيقونة الساعة أعلى المحرّر وعُد إلى نسخة سابقة.",
        },
      ],
    },
    {
      icon: "controls",
      heading: "الأزرار حول المحادثة",
      items: [
        {
          title: "‏+ (بجانب حقل الكتابة)",
          body: "إرفاق مستند، إرسال صورة من المعرض، التقاط صورة بالكاميرا، أو لصق صورة نسختها.",
        },
        {
          title: "الساعة في الأعلى",
          body: "كل محادثاتك. ابدأ واحدة جديدة، أو أعد تسمية محادثة قديمة أو ثبّتها أو أرشفها.",
        },
        {
          title: "تحت الإجابة",
          body: "«استماع» يقرأها بصوت مسموع، «إعادة» يطلبها من جديد، و«عرض الكل» يفتح الإجابة الطويلة في صفحة كاملة.",
        },
        {
          title: "إيقاف",
          body: "أثناء عمله يتحوّل زر الإرسال إلى «إيقاف»، وينهي الدور فورًا.",
        },
      ],
    },
  ],
  examplesHeading: "جرّب أن تسأل",
  examples: [
    "اكتب المقدمة العامة انطلاقًا من خطتي، في حدود 400 كلمة.",
    "اجعل الفقرة الثانية من الفصل النظري أكثر أكاديمية.",
    "أضف جدولًا يقارن بين المقاربات الثلاث، مع تسمية توضيحية.",
    "اضبط تنسيق المستند كله: خط Traditional Arabic حجم 14 وتباعد 1.5.",
    "ولّد فهرس المحتويات وقائمة الأشكال.",
    "اقرأ الملف الذي أرفقته للتوّ وقل لي ما الذي يمكنني استعماله في الفصل الثاني.",
  ],
  noteHeading: "ما يجدر أن تعرفه",
  note: "كويل مساعد، لا مشرف. تحقّق من المعلومات والأرقام وكل مرجع قبل التسليم — فالعمل مسؤوليتك، وقواعد جامعتك بشأن الذكاء الاصطناعي تبقى سارية. المهمة الطويلة قد تستغرق دقيقة، والاتصال بالإنترنت ضروري.",
};

const GUIDES: Record<Lang, ChatGuide> = { en: EN, fr: FR, ar: AR };

/** The guide in the reader's language; anything unrecognised falls back to French,
 *  which is what getStoredLanguage() defaults to. */
export function getChatGuide(lang: string): ChatGuide {
  const key = lang.split("-")[0] as Lang;
  return GUIDES[key] ?? GUIDES.fr;
}
