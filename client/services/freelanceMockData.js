// Dummy/mock data for freelance marketplace
export const mockRequests = [
  {
    id: '1',
    title: 'مساعدة في تنسيق مذكرة تخرج',
    shortDescription: 'أحتاج إلى تنسيق مذكرة تخرج وفقًا لمعايير الجامعة.',
    category: 'تنسيق',
    description: 'أحتاج إلى شخص لديه خبرة في تنسيق مذكرات التخرج باستخدام Word أو LaTeX. يجب الالتزام بمعايير الجامعة وتنسيق الفهارس والمراجع.',
    deadline: '2025-05-10',
    budget: '2000 دج',
    status: 'بانتظار',
    student: {
      name: 'أحمد بن يوسف',
      email: 'ahmed@student.edu',
    },
    files: [],
  },
  {
    id: '2',
    title: 'مراجعة لغوية لمذكرة',
    shortDescription: 'أحتاج إلى تدقيق لغوي لمذكرة من 60 صفحة.',
    category: 'تدقيق لغوي',
    description: 'مطلوب تدقيق لغوي لمذكرة تخرج في مجال علوم الحاسوب. يجب تصحيح الأخطاء الإملائية والنحوية وتحسين الأسلوب.',
    deadline: '2025-05-15',
    budget: '1500 دج',
    status: 'مقبول',
    student: {
      name: 'سارة بوزيد',
      email: 'sara@student.edu',
    },
    files: [],
  },
];

export const mockOffers = [
  {
    id: '1',
    requestId: '1',
    offerPrice: '1800 دج',
    deliveryTime: '3 أيام',
    note: 'جاهز للبدء فورًا. لدي خبرة في تنسيق المذكرات.',
    status: 'بانتظار',
  },
  {
    id: '2',
    requestId: '2',
    offerPrice: '1400 دج',
    deliveryTime: '2 أيام',
    note: 'سأقوم بمراجعة دقيقة وسريعة.',
    status: 'مقبول',
  },
];

export const mockChats = {
  '1': [
    { from: 'student', text: 'مرحبًا، هل يمكنك البدء اليوم؟', time: '10:00' },
    { from: 'freelancer', text: 'نعم، أستطيع البدء فورًا.', time: '10:01' },
  ],
  '2': [
    { from: 'student', text: 'هل لديك خبرة في التدقيق اللغوي؟', time: '09:00' },
    { from: 'freelancer', text: 'نعم، لدي خبرة واسعة.', time: '09:02' },
  ],
};
