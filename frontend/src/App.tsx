import { useEffect } from 'react'
import { createBrowserRouter, RouterProvider, createRoutesFromElements, Route, Navigate, Outlet } from 'react-router-dom'
import ShellLayout from './components/ShellLayout'
import HomePage from './pages/HomePage'
import AnalysisResultPage from './pages/AnalysisResultPage'
import HistoryAnalysisPage from './pages/HistoryAnalysisPage'
import TaskListPage from './pages/TaskListPage'
import TaskAgentPage from './pages/TaskAgentPage'
import TaskDecisionPage from './pages/TaskDecisionPage'
import TaskManualPage from './pages/TaskManualPage'
import SettingsPage from './pages/SettingsPage'
import A2uiPage from './pages/A2uiPage'
import LoginPage from './pages/LoginPage'
import { useAuthStore } from './stores/authStore'
import { usePetStore } from './stores/petStore'

function ProtectedLayout() {
  const { isAuthenticated, isLoading, loadUser, token, user } = useAuthStore()
  const initPetFromUser = usePetStore(s => s.initFromUser)

  useEffect(() => {
    if (token && !isAuthenticated) {
      loadUser()
    }
  }, [])

  useEffect(() => {
    if (user) {
      initPetFromUser(user.adoptedPetId)
    }
  }, [user?.adoptedPetId])

  if (isLoading) {
    return (
      <div className="auth-loading">
        <div className="auth-loading-spinner" />
        <p>加载中...</p>
      </div>
    )
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />
  }

  return (
    <ShellLayout>
      <Outlet />
    </ShellLayout>
  )
}

const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/analysis/:taskId?" element={<AnalysisResultPage />} />
        <Route path="/history" element={<HistoryAnalysisPage />} />
        <Route path="/tasks" element={<TaskListPage />} />
        <Route path="/task/agent/:id" element={<TaskAgentPage />} />
        <Route path="/task/decision/:id" element={<TaskDecisionPage />} />
        <Route path="/task/manual/:id" element={<TaskManualPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/a2ui" element={<A2uiPage />} />
      </Route>
    </>
  )
)

function App() {
  return <RouterProvider router={router} />
}

export default App
