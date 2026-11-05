import React, { useState } from 'react';

/**
 * Campo de contraseña interactivo con botón para mostrar/ocultar
 * utilizando los emoticones de mono 🙈 (oculto) y 🐵 (visible).
 */
export default function PasswordInput({
  label = undefined,
  value,
  onChange,
  placeholder = 'Contraseña',
  required = false,
  className = 'form-input-figma',
  style = {},
  disabled = false,
  autoComplete = 'current-password',
  name = 'password',
  id = undefined
}) {
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div style={{ position: 'relative', width: '100%', marginBottom: '10px' }}>
      {label && (
        <label style={{ display: 'block', marginBottom: '4px', fontSize: '0.84rem', fontWeight: 600, color: '#374151' }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative', width: '100%' }}>
        <input
          type={showPassword ? 'text' : 'password'}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          required={required}
          disabled={disabled}
          autoComplete={autoComplete}
          name={name}
          id={id}
          className={className}
          style={{
            width: '100%',
            paddingRight: '44px',
            boxSizing: 'border-box',
            ...style
          }}
        />
        <button
          type="button"
          onClick={() => setShowPassword(!showPassword)}
          tabIndex={-1}
          title={showPassword ? 'Ocultar contraseña' : 'Ver contraseña'}
          style={{
            position: 'absolute',
            right: '8px',
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'none',
            border: 'none',
            fontSize: '1.35rem',
            cursor: 'pointer',
            padding: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            lineHeight: 1,
            userSelect: 'none'
          }}
        >
          {showPassword ? '🐵' : '🙈'}
        </button>
      </div>
    </div>
  );
}
