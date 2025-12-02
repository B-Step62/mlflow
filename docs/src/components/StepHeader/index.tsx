import React from 'react';
import styles from './styles.module.css';

interface StepHeaderProps {
  number: number;
  title: string;
}

const StepHeader: React.FC<StepHeaderProps> = ({ number, title }) => {
  // Generate a slug from the title for the heading ID
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return (
    <div className={styles.stepHeader}>
      <div className={styles.stepNumber}>{number}</div>
      <h3 id={slug} className={styles.stepTitle}>
        {title}
        <a
          className="hash-link"
          href={`#${slug}`}
          title="Direct link to heading"
        >
          ​
        </a>
      </h3>
    </div>
  );
};

export default StepHeader;

