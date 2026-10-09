export default function Logo() {
  return (
    <div className="flex mb-8 justify-center select-none">
      <div className="relative select-none">
        <img
          src="/allpaca-logo.png"
          alt="Allpaca"
          width={60}
          height={60}
          className="select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}