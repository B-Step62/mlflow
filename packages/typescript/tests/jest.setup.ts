import { spawn, ChildProcess } from 'child_process';
import { init } from '../src/core';

let mlflowProcess: ChildProcess;

beforeAll(async () => {
  // Start MLflow UI
  // mlflowProcess = spawn('mlflow', ['server', '--port', '5000']);

  // Wait for MLflow to be ready
  // await new Promise(resolve => setTimeout(resolve, 3000));

  // Configure tracing
  init({
    tracking_uri: 'http://localhost:5000',
    experiment_id: '0',
  })
});

afterAll(() => {
  // // Clean up
  // if (mlflowProcess) {
  //   mlflowProcess.kill();
  // }
});