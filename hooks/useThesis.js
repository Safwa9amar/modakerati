import { useState, useEffect, createContext, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';

const ThesisContext = createContext();

export function ThesisProvider({ children }) {
  const [projects, setProjects] = useState([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadProjects();
  }, []);

  const loadProjects = async () => {
    try {
      const projectsJSON = await AsyncStorage.getItem('thesis_projects');
      if (projectsJSON) {
        setProjects(JSON.parse(projectsJSON));
      }
    } catch (error) {
      console.error('Failed to load projects:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveProjects = async (updatedProjects) => {
    try {
      await AsyncStorage.setItem('thesis_projects', JSON.stringify(updatedProjects));
      setProjects(updatedProjects);
    } catch (error) {
      console.error('Failed to save projects:', error);
      throw error;
    }
  };

  const createProject = async (projectData) => {
    const newProject = {
      id: Date.now().toString(),
      createdAt: new Date().toISOString(),
      documents: [],
      ...projectData,
    };
    
    // Create project directory
    const projectDir = `${FileSystem.documentDirectory}projects/${newProject.id}`;
    await FileSystem.makeDirectoryAsync(projectDir, { intermediates: true });
    
    const updatedProjects = [...projects, newProject];
    await saveProjects(updatedProjects);
    return newProject;
  };

  const updateProject = async (id, updates) => {
    const updatedProjects = projects.map(project => 
      project.id === id ? { ...project, ...updates } : project
    );
    await saveProjects(updatedProjects);
    return updatedProjects.find(p => p.id === id);
  };

  const deleteProject = async (id) => {
    // Delete project files
    try {
      const projectDir = `${FileSystem.documentDirectory}projects/${id}`;
      await FileSystem.deleteAsync(projectDir, { idempotent: true });
    } catch (error) {
      console.error('Error deleting project files:', error);
    }
    
    const updatedProjects = projects.filter(project => project.id !== id);
    await saveProjects(updatedProjects);
  };

  const addDocumentToProject = async (projectId, documentInfo) => {
    const project = projects.find(p => p.id === projectId);
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
    
    const updatedProjects = projects.map(p => 
      p.id === projectId ? updatedProject : p
    );
    
    await saveProjects(updatedProjects);
    return newDoc;
  };

  const removeDocumentFromProject = async (projectId, documentId) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) throw new Error('Project not found');
    
    // Delete document file if it exists
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
    
    const updatedProjects = projects.map(p => 
      p.id === projectId ? updatedProject : p
    );
    
    await saveProjects(updatedProjects);
  };

  return (
    <ThesisContext.Provider
      value={{
        projects,
        isLoading,
        createProject,
        updateProject,
        deleteProject,
        addDocumentToProject,
        removeDocumentFromProject,
      }}
    >
      {children}
    </ThesisContext.Provider>
  );
}

export const useThesis = () => useContext(ThesisContext);