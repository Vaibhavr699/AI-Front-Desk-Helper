import { useState, useCallback } from 'react'
import Nav from '../components/Nav'
import Footer from '../components/Footer'
import Hero from '../sections/Hero'
import HowItWorks from '../sections/HowItWorks'
import SellMore from '../sections/SellMore'
import Features from '../sections/Features'
import Pricing from '../sections/Pricing'
import CTA from '../sections/CTA'

export default function Landing() {
  const [navVisible, setNavVisible] = useState(false)
  const handleIntroComplete = useCallback(() => setNavVisible(true), [])

  return (
    <div className="min-h-screen bg-black">
      <Nav visible={navVisible} />
      <Hero onIntroComplete={handleIntroComplete} />
      <HowItWorks />
      <SellMore />
      <Features />
      <Pricing />
      <CTA />
      <Footer />
    </div>
  )
}
