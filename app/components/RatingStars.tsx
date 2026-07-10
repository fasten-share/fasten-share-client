import styles from './ConsumerInfo.module.css';

export function RatingStars({ value, disabled, label, onChange }: {
  value: number;
  disabled: boolean;
  label: (rating: number) => string;
  onChange: (rating: number) => void;
}) {
  return <div className={styles.ratingStars}>
    {[1, 2, 3, 4, 5].map((star) => {
      const fill = value >= star ? 100 : value >= star - 0.5 ? 50 : 0;
      return <span className={styles.ratingStar} key={star}>
        <span className={styles.ratingStarBase} aria-hidden="true">★</span>
        <span className={styles.ratingStarFill} style={{ width: `${fill}%` }} aria-hidden="true">★</span>
        <button type="button" className={styles.ratingStarLeft} disabled={disabled} aria-label={label(star - 0.5)} onClick={() => onChange(star - 0.5)} />
        <button type="button" className={styles.ratingStarRight} disabled={disabled} aria-label={label(star)} onClick={() => onChange(star)} />
      </span>;
    })}
  </div>;
}
