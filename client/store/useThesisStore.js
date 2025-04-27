import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

export const useThesisStore = create((set, get) => ({
  projects: [],
  isLoading: true,

  loadProjects: async () => {
    try {
      const projectsJSON = await AsyncStorage.getItem('thesis_projects');
      if (projectsJSON) {
        set({ projects: JSON.parse(projectsJSON) });
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      set({ isLoading: false });
    }
  },

  saveProjects: async (updatedProjects) => {
    try {
      await AsyncStorage.setItem('thesis_projects', JSON.stringify(updatedProjects));
      set({ projects: updatedProjects });
    } catch (error) {
      console.error('Failed to save projects:', error);
      throw error;
    }
  },

  createProject: async (projectData) => {
    const newProject = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      documents: [],
      ...projectData,
    };
    const projectDir = `${FileSystem.documentDirectory}projects/${newProject.id}`;
    await FileSystem.makeDirectoryAsync(projectDir, { intermediates: true });
    const updatedProjects = [...get().projects, newProject];
    await get().saveProjects(updatedProjects);
    return newProject;
  },

  updateProject: async (id, updates) => {
    const updatedProjects = get().projects.map(project =>
      project.id === id ? { ...project, ...updates } : project
    );
    await get().saveProjects(updatedProjects);
    return updatedProjects.find(p => p.id === id);
  },

  deleteProject: async (id) => {
    try {
      const projectDir = `${FileSystem.documentDirectory}projects/${id}`;
      await FileSystem.deleteAsync(projectDir, { idempotent: true });
    } catch (error) {
      console.error('Error deleting project files:', error);
    }
    const updatedProjects = get().projects.filter(project => project.id !== id);
    await get().saveProjects(updatedProjects);
  },

  addDocumentToProject: async (projectId, documentInfo) => {
    const project = get().projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    const newDoc = {
      id: Date.now().toString(),
      addedAt: new Date().toISOString(),
      ...documentInfo,
    };
    const updatedProject = {
      ...project,
      documents: [...project.documents, newDoc],
    };
    const updatedProjects = get().projects.map(p =>
      p.id === projectId ? updatedProject : p
    );
    await get().saveProjects(updatedProjects);
    return newDoc;
  },

  removeDocumentFromProject: async (projectId, documentId) => {
    const project = get().projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    try {
      const document = project.documents.find(d => d.id === documentId);
      if (document && document.uri) {
        await FileSystem.deleteAsync(document.uri, { idempotent: true });
      }
    } catch (error) {
      console.error('Error deleting document file:', error);
    }
    const updatedProject = {
      ...project,
      documents: project.documents.filter(doc => doc.id !== documentId),
    };
    const updatedProjects = get().projects.map(p =>
      p.id === projectId ? updatedProject : p
    );
    await get().saveProjects(updatedProjects);
  },
}));

export const useThesisStoreInit = () => {
  const loadProjects = useThesisStore(state => state.loadProjects);
  // Call this in your root or screen to load projects on mount
  // React.useEffect(() => { loadProjects(); }, [loadProjects]);
};
