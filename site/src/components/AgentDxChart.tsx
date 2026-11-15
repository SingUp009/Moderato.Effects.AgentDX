import { useState } from 'react';

type Row = {
    model: string;
    condition: string;
    label: string;
    planned: number;
    firstBuild: number;
    finalPass: number;
};

type Experiment = {
    id: string;
    label: string;
    title: string;
    description: string;
    deadlineSeconds: number;
    rows: Row[];
};

export default function AgentDxChart({ experiments }: { experiments: Experiment[] }) {
    const [experimentIndex, setExperimentIndex] = useState(0);
    const [metric, setMetric] = useState<'finalPass' | 'firstBuild'>('finalPass');
    const [model, setModel] = useState('all');
    const experiment = experiments[experimentIndex];
    const models = [...new Set(experiment.rows.map(row => row.model))];
    const show = model === 'all' ? models : [model];

    return (
        <div className="dx-chart">
            <div className="dx-experiments" role="group" aria-label="Experiment">
                {experiments.map((entry, index) => (
                    <button key={entry.id} type="button" aria-pressed={index === experimentIndex}
                        onClick={() => {
                            setExperimentIndex(index);
                            setModel('all');
                        }}>
                        {entry.label}
                    </button>
                ))}
            </div>
            <div className="dx-chart-heading">
                <div>
                    <h3>{experiment.title}</h3>
                    <p>{experiment.description}</p>
                </div>
                <div className="dx-controls">
                    <label>
                        Metric
                        <select value={metric} onChange={event => setMetric(event.target.value === 'firstBuild' ? 'firstBuild' : 'finalPass')}>
                            <option value="finalPass">All tests passed</option>
                            <option value="firstBuild">First build passed</option>
                        </select>
                    </label>
                    {models.length > 1 && (
                        <label>
                            Model
                            <select value={model} onChange={event => setModel(event.target.value)}>
                                <option value="all">Both models</option>
                                {models.map(name => <option key={name} value={name}>{name}</option>)}
                            </select>
                        </label>
                    )}
                </div>
            </div>
            <div className="dx-panels" aria-live="polite">
                {show.map(name => (
                    <div key={name} className="dx-panel">
                        <h4>{name}</h4>
                        <div className="dx-scale" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
                        <ul aria-label={metric === 'finalPass' ? 'All tests passed' : 'First implementation build passed'}>
                            {experiment.rows.filter(row => row.model === name).map(row => {
                                const percentage = 100 * row[metric] / row.planned;
                                return (
                                    <li key={row.condition} data-condition={row.condition}>
                                        <div className="dx-bar-label">
                                            <span>{row.label}</span>
                                            <strong>{row[metric]}/{row.planned}</strong>
                                        </div>
                                        <div className="dx-track" aria-hidden="true">
                                            <div className="dx-bar" style={{ width: percentage + '%' }} />
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                ))}
            </div>
            <p className="dx-chart-note">Counts use all planned runs. The model deadline was {experiment.deadlineSeconds} seconds.</p>
        </div>
    );
}
