import React, { useState } from 'react';
import { Box, Typography } from '@mui/material';

interface LogoProps {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fallbackText?: string;
  href?: string;
}

export default function Logo({ src, alt, width = 120, height = 32, fallbackText, href }: LogoProps) {
  const [imageError, setImageError] = useState(false);

  const linkStyle: React.CSSProperties = {
    display: 'inline-flex',
    textDecoration: 'none',
  };

  if (imageError && fallbackText) {
    const content = (
      <Typography
        sx={{
          color: '#fe5000',
          fontWeight: 700,
          fontSize: '1rem',
          letterSpacing: '0.1em',
        }}
      >
        {fallbackText}
      </Typography>
    );

    if (href) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          {content}
        </a>
      );
    }
    return content;
  }

  const boxContent = (
    <Box sx={{ position: 'relative', width, height }}>
      <img
        src={src}
        alt={alt}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        onError={() => setImageError(true)}
      />
    </Box>
  );

  if (href) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" style={linkStyle}>
        {boxContent}
      </a>
    );
  }
  return boxContent;
}
