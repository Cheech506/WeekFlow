// These are the API fields our test screen needs.
// This is separate from the task data stored in SQLite.
export type ServerTask = {
  id: number;
  title: string;
  due_date: string | null;
  completed: boolean;
};

export async function fetchServerTasks(baseUrl: string): Promise<ServerTask[]> {
  // GET reads tasks; it does not create, update, or delete anything.
  const response = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'GET',
  });

  if (!response.ok) {
    throw new Error(`Task API returned ${response.status}`);
  }

  const data: unknown = await response.json();
  if (!Array.isArray(data)) {
    throw new Error('Expected a list of tasks from the API');
  }

  return data as ServerTask[];
}